import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText, collectDependencies, safeUpgrade } from '../plugins/secure-code-guardian/mcp/server.mjs';
import { applyBump } from '../plugins/ship-ready/mcp/lib/git.mjs';

const server = (p) => fileURLToPath(new URL(`../plugins/${p}/mcp/server.mjs`, import.meta.url));

/** Tiny MCP stdio client: sends requests and resolves responses by id. */
function connect(script) {
  const child = spawn('node', [script], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PLUGIN_ROOT: '/nonexistent' } });
  const pending = new Map();
  let buf = '';
  let nextId = 1;
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg);
    }
  });
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result;
  return { request, call, close: () => child.kill() };
}

let repo;
before(() => {
  repo = mkdtempSync(join(tmpdir(), 'apd-mcp-'));
  const g = (...a) => spawnSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'demo@example.com');
  g('config', 'user.name', 'Demo');
  writeFileSync(join(repo, 'README.md'), `# Demo\n\n${'Useful documentation. '.repeat(40)}\n`);
  writeFileSync(join(repo, 'LICENSE'), 'MIT');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'demo', version: '1.2.3', scripts: { build: 'tsc', test: 'vitest' }, dependencies: { express: '^4.18.2' } }));
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'index.js'), 'export const add = (a, b) => a + b; // TODO: validate\n');
  writeFileSync(join(repo, 'src', 'index.test.js'), 'test("add", () => {});\n');
  g('add', '.');
  g('commit', '-q', '-m', 'chore: scaffold');
  g('tag', 'v1.2.3');
  writeFileSync(join(repo, 'src', 'feature.js'), 'export const f = 1;\n');
  g('add', '.');
  g('commit', '-q', '-m', 'feat(api): add supplier search');
  writeFileSync(join(repo, 'src', 'fix.js'), 'export const x = 2;\n');
  g('add', '.');
  g('commit', '-q', '-m', 'fix: handle empty cart');
});
after(() => rmSync(repo, { recursive: true, force: true }));

for (const [plugin, expectedTools] of [
  ['ship-ready', ['readiness_scan', 'changelog_from_git', 'suggest_version_bump']],
  ['secure-code-guardian', ['scan_secrets', 'check_dependencies']],
]) {
  test(`${plugin} MCP server: initialize + tools/list`, async () => {
    const c = connect(server(plugin));
    try {
      const init = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
      assert.equal(init.result.protocolVersion, '2025-06-18');
      assert.ok(init.result.capabilities.tools);
      const list = await c.request('tools/list', {});
      assert.deepEqual(list.result.tools.map((t) => t.name).sort(), [...expectedTools].sort());
      for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object');
      const unknown = await c.request('does/not/exist', {});
      assert.equal(unknown.error.code, -32601);
    } finally {
      c.close();
    }
  });
}

test('ship-ready tools produce a score, changelog and version bump', async () => {
  const c = connect(server('ship-ready'));
  try {
    await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const scan = (await c.call('readiness_scan', { path: repo })).content[0].text;
    assert.match(scan, /Score: \d+\/100/);
    assert.match(scan, /\| Docs \| LICENSE \| ✅/);

    const log = (await c.call('changelog_from_git', { path: repo, version: '1.3.0' })).content[0].text;
    assert.match(log, /## 1\.3\.0/);
    assert.match(log, /Features[\s\S]*\*\*api:\*\* add supplier search/);
    assert.match(log, /Bug fixes[\s\S]*handle empty cart/);
    assert.doesNotMatch(log, /scaffold/, 'commits before the latest tag are excluded');

    const bump = (await c.call('suggest_version_bump', { path: repo })).content[0].text;
    assert.match(bump, /`minor` → `1\.3\.0`/);

    const missing = await c.call('readiness_scan', { path: join(repo, 'nope') });
    assert.equal(missing.isError, true);

    const injected = await c.call('changelog_from_git', { path: repo, to: `--output=${join(repo, 'pwned')}` });
    assert.equal(injected.isError, true);
    assert.equal(existsSync(join(repo, 'pwned')), false, 'git option injection must be rejected');
  } finally {
    c.close();
  }
});

test('semver bump rules', () => {
  assert.equal(applyBump('1.2.3', 'major'), '2.0.0');
  assert.equal(applyBump('v1.2.3', 'minor'), '1.3.0');
  assert.equal(applyBump('1.2.3', 'patch'), '1.2.4');
  assert.equal(applyBump('0.4.1', 'major'), '0.5.0');
});

test('guardian secret rules detect real patterns, mask values and skip placeholders', () => {
  // Built at runtime so this test file itself never contains a secret-looking literal.
  const aws = ['AKIA', 'Z'.repeat(4), '1234567890AB'].join('');
  const gh = ['ghp', '_', 'a1B2'.repeat(9)].join('');
  const text = [`const key = "${aws}";`, `token: ${gh}`, 'password = "changeme-example"', `api_key = "${'s3cr3tV4lue'}9x"`].join('\n');
  const findings = scanText(text, 'src/config.js');
  assert.deepEqual(findings.map((f) => f.rule), ['aws-access-key', 'github-token', 'hardcoded-credential']);
  assert.ok(findings.every((f) => !f.preview.includes(aws) && !f.preview.includes(gh)));
});

test('guardian scan_secrets tool reports findings over MCP', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apd-secrets-'));
  writeFileSync(join(dir, 'app.js'), `const k = "${['AKIA', 'Q'.repeat(16)].join('')}";\n`);
  const c = connect(server('secure-code-guardian'));
  try {
    await c.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const out = (await c.call('scan_secrets', { path: dir })).content[0].text;
    assert.match(out, /critical 1/);
    assert.match(out, /AWS access key ID/);
    assert.doesNotMatch(out, /AKIAQQQQQQQQQQQQQQQQ/);
  } finally {
    c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('guardian resolves dependency versions from lockfiles and ranges', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apd-deps-'));
  try {
    mkdirSync(join(dir, 'api'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['api'] }));
    writeFileSync(join(dir, 'api', 'package.json'), JSON.stringify({ dependencies: { express: '^4.18.0', lodash: '~4.17.0' }, devDependencies: { local: 'file:../x' } }));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/express': { version: '4.21.2' } } }));
    writeFileSync(join(dir, 'requirements.txt'), 'flask==2.0.1\nrequests>=2\n');
    const deps = collectDependencies(dir).map((d) => `${d.ecosystem}:${d.name}@${d.version}:${d.source}`).sort();
    assert.deepEqual(deps, ['PyPI:flask@2.0.1:pinned', 'npm:express@4.21.2:lockfile', 'npm:lodash@4.17.0:range']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('safe upgrade prefers the highest fix on the installed major line', () => {
  assert.equal(safeUpgrade('1.8.1', ['1.8.2', '0.30.0', '1.16.0', '1.12.0']), '1.16.0');
  assert.equal(safeUpgrade('2.0.0', ['3.1.0', '3.0.1']), '3.0.1');
  assert.equal(safeUpgrade('5.0.0', ['4.0.0']), '—');
});
