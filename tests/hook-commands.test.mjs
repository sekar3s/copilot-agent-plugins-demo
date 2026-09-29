// Runs every generated hooks.json command the way each client does:
//  1. "plugin runtime" (Copilot CLI, Copilot app): ${PLUGIN_ROOT} is replaced with the plugin folder.
//  2. VS Code (Copilot and Local session targets): ${PLUGIN_ROOT} is NOT expanded and the command
//     runs from the workspace. The bootstrap must find the installed copy of the plugin.
//  3. Plugin not found anywhere: the command must exit 0 silently so it never blocks the agent.
// POSIX runs the commands with /bin/sh; Windows runs them with both PowerShell and cmd.exe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOKS, hooksPath, BOOTSTRAP } from '../tools/build-hooks.mjs';
import { validateAutomation } from '../tools/validate.mjs';

const PLUGINS = fileURLToPath(new URL('../plugins/', import.meta.url));
const SHELLS =
  process.platform === 'win32'
    ? [
        ['powershell', (c) => ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', c]]],
        ['cmd', (c) => ['cmd.exe', ['/d', '/s', '/c', c]]],
      ]
    : [['sh', (c) => ['/bin/sh', ['-c', c]]]];

function makeWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), 'apd-ws-'));
  writeFileSync(join(ws, 'README.md'), '# Demo\n');
  spawnSync('git', ['init', '-q'], { cwd: ws });
  return ws;
}

/** A fake home directory; optionally with the plugin installed the way VS Code or the CLI does. */
function makeHome(plugin, layout) {
  const home = mkdtempSync(join(tmpdir(), 'apd-home-'));
  if (layout === 'vscode-agent-host') cpSync(join(PLUGINS, plugin), join(home, '.config', 'Code', 'agentPlugins', `file-demo-plugins-${plugin}`, '1a2b3c'), { recursive: true });
  if (layout === 'vscode-marketplace') cpSync(join(PLUGINS, plugin), join(home, '.vscode', 'agent-plugins', 'github.com', 'sekar3s', 'copilot-agent-plugins-demo', 'plugins', plugin), { recursive: true });
  if (layout === 'copilot-cli') cpSync(join(PLUGINS, plugin), join(home, '.copilot', 'installed-plugins', 'copilot-agent-plugins-demo', plugin), { recursive: true });
  mkdirSync(join(home, '.config'), { recursive: true });
  return home;
}

function run(shell, command, payload, { cwd, home }) {
  const [cmd, args] = shell(command);
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, '.config'), PLUGIN_DATA: join(home, 'data') };
  for (const k of ['PLUGIN_ROOT', 'COPILOT_HOME']) delete env[k];
  return spawnSync(cmd, args, { cwd, input: JSON.stringify(payload), encoding: 'utf8', env });
}

const payloadFor = (event, cwd) =>
  ({
    sessionStart: { sessionId: 's1', cwd, source: 'new' },
    preToolUse: { sessionId: 's1', cwd, toolName: 'bash', toolArgs: JSON.stringify({ command: 'cat .env' }) },
    postToolUse: { sessionId: 's1', cwd, toolName: 'bash', toolArgs: '{"command":"npm test"}', toolResult: { resultType: 'success' } },
  })[event];

function assertWorked(event, r) {
  assert.equal(r.status, 0, r.stderr);
  if (event === 'sessionStart') assert.ok(JSON.parse(r.stdout).additionalContext, `sessionStart adds context: ${r.stdout}${r.stderr}`);
  if (event === 'preToolUse') assert.equal(JSON.parse(r.stdout).permissionDecision, 'deny', `cat .env is denied: ${r.stdout}${r.stderr}`);
}

test('bootstrap stays free of shell-sensitive characters', () => assert.doesNotMatch(BOOTSTRAP, /["$`%\\]/));

for (const plugin of Object.keys(HOOKS)) {
  test(`${plugin} hooks.json is generated from tools/build-hooks.mjs`, () => {
    assert.equal(readFileSync(hooksPath(plugin), 'utf8').replace(/\r\n/g, '\n'), `${JSON.stringify({ version: 1, hooks: HOOKS[plugin] }, null, 2)}\n`);
  });

  const hooks = JSON.parse(readFileSync(hooksPath(plugin), 'utf8')).hooks;
  for (const [event, entries] of Object.entries(hooks)) {
    for (const [shellName, shell] of SHELLS) {
      const command = entries[0].command;
      const label = `${plugin} ${event} (${shellName})`;

      test(`${label}: CLI / Copilot app — \${PLUGIN_ROOT} expanded`, () => {
        const ws = makeWorkspace();
        const home = makeHome(plugin, null);
        try {
          const r = run(shell, command.replaceAll('${PLUGIN_ROOT}', join(PLUGINS, plugin)), payloadFor(event, ws), { cwd: join(PLUGINS, plugin), home });
          assertWorked(event, r);
        } finally {
          rmSync(ws, { recursive: true, force: true });
          rmSync(home, { recursive: true, force: true });
        }
      });

      for (const layout of ['vscode-agent-host', 'vscode-marketplace', 'copilot-cli']) {
        test(`${label}: VS Code — no expansion, plugin found via ${layout} layout`, () => {
          const ws = makeWorkspace();
          const home = makeHome(plugin, layout);
          try {
            assertWorked(event, run(shell, command, payloadFor(event, ws), { cwd: ws, home }));
          } finally {
            rmSync(ws, { recursive: true, force: true });
            rmSync(home, { recursive: true, force: true });
          }
        });
      }

      test(`${label}: plugin not installed — exits 0 without output`, () => {
        const ws = makeWorkspace();
        const home = makeHome(plugin, null);
        try {
          const r = run(shell, command, payloadFor(event, ws), { cwd: ws, home });
          assert.equal(r.status, 0, r.stderr);
          assert.equal(r.stdout.trim(), '');
        } finally {
          rmSync(ws, { recursive: true, force: true });
          rmSync(home, { recursive: true, force: true });
        }
      });
    }
  }
}

test('an unexpanded ${PLUGIN_ROOT} folder inside the workspace is never trusted (cmd.exe passes the literal text)', () => {
  const ws = makeWorkspace();
  const home = makeHome('secure-code-guardian', null);
  try {
    const fake = join(ws, '${PLUGIN_ROOT}');
    mkdirSync(join(fake, 'scripts'), { recursive: true });
    writeFileSync(join(fake, 'plugin.json'), JSON.stringify({ name: 'secure-code-guardian' }));
    writeFileSync(join(fake, 'scripts', 'guard.mjs'), "process.stdout.write('PWNED')");
    const cmd = JSON.parse(readFileSync(hooksPath('secure-code-guardian'), 'utf8')).hooks.preToolUse[0].command;
    // Simulate cmd.exe: the placeholder reaches node as literal text.
    const r = run(SHELLS[0][1], cmd.replace('"${PLUGIN_ROOT}"', "'${PLUGIN_ROOT}'"), payloadFor('preToolUse', ws), { cwd: ws, home });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /PWNED/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('the plugin root is the last argument, so a dropped empty argument cannot shift the others', () => {
  for (const plugin of Object.keys(HOOKS)) {
    for (const [, entries] of Object.entries(HOOKS[plugin])) assert.match(entries[0].command, / scripts\/[\w.-]+ "\$\{PLUGIN_ROOT\}"$/);
  }
});

test('automation templates follow the VS Code format', () => {
  const ok = `---\nversion: 1\nid: nightly-check\nname: Nightly\nschedule:\n  kind: cron\n  expression: "30 2 * * *"\n  timeZone: local\n---\nDo it.`;
  assert.deepEqual(validateAutomation(ok), { id: 'nightly-check', schedule: 'daily' });
  assert.equal(validateAutomation(ok.replace('"30 2 * * *"', '"0 9 * * 1"')).schedule, 'weekly');
  assert.equal(validateAutomation(ok.replace(/schedule:[\s\S]*?---/, 'schedule:\n  kind: manual\n---')).schedule, 'manual');
  assert.throws(() => validateAutomation(ok.replace('"30 2 * * *"', '"0 9 1 * *"')), /unsupported cron/);
  assert.throws(() => validateAutomation(ok.replace('timeZone: local', 'timeZone: UTC')), /timeZone/);
  assert.throws(() => validateAutomation(ok.replace('id: nightly-check', 'id: Nightly')), /invalid id/);
  assert.throws(() => validateAutomation(ok.replace('name: Nightly', 'name: Nightly\nmodel: gpt')), /unknown property/);
  assert.throws(() => validateAutomation(ok.replace('Do it.', '')), /prompt/);
});
