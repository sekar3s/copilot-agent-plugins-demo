import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const plugin = (p) => fileURLToPath(new URL(`../plugins/${p}`, import.meta.url));
let repo;
let dataDir;

before(() => {
  repo = mkdtempSync(join(tmpdir(), 'apd-hooks-'));
  dataDir = mkdtempSync(join(tmpdir(), 'apd-data-'));
  const g = (...a) => spawnSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'demo@example.com');
  g('config', 'user.name', 'Demo');
  writeFileSync(join(repo, 'README.md'), '# Demo\n');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'vitest' }, dependencies: { express: '^4.0.0' } }));
  g('add', '.');
  g('commit', '-q', '-m', 'feat: initial');
});

after(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

const run = (script, payload) =>
  spawnSync('node', [script], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, PLUGIN_DATA: dataDir } });

for (const [name, script, expected] of [
  ['ship-ready session context (Copilot payload)', 'ship-ready/scripts/session-context.mjs', /Branch: main/],
  ['secure-code-guardian session policy', 'secure-code-guardian/scripts/session-policy.mjs', /Secure Code Guardian is active/],
  ['docs-onboarding-buddy repo map', 'docs-onboarding-buddy/scripts/repo-map-context.mjs', /Repo map/],
]) {
  test(`sessionStart: ${name}`, () => {
    for (const payload of [{ cwd: repo, source: 'new', sessionId: 's1' }, { hook_event_name: 'SessionStart', cwd: repo, session_id: 's1', source: 'new' }]) {
      const r = run(plugin(script), payload);
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.match(out.additionalContext, expected);
      assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
      assert.equal(out.hookSpecificOutput.additionalContext, out.additionalContext);
    }
  });
}

test('postToolUse audit hook writes JSON lines for both payload shapes', () => {
  const script = plugin('ship-ready/scripts/audit-tool.mjs');
  run(script, { toolName: 'bash', toolArgs: '{"command":"npm test"}', toolResult: { resultType: 'success' }, cwd: repo, sessionId: 'a' });
  run(script, { hook_event_name: 'PostToolUse', tool_name: 'read_file', tool_input: { filePath: 'README.md' }, tool_result: { result_type: 'success' }, cwd: repo, session_id: 'b' });
  const lines = readFileSync(join(dataDir, 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.event === 'postToolUse');
  assert.deepEqual(lines.map((l) => [l.tool, l.target, l.result]), [
    ['bash', 'npm test', 'success'],
    ['read_file', 'README.md', 'success'],
  ]);
});
