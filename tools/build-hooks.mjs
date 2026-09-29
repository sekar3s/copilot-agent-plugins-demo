#!/usr/bin/env node
// Generates com.github.copilot/hooks/hooks.json for every plugin.
//
// Each hook must work everywhere a Copilot client runs hooks:
//   - Copilot CLI / Copilot app: set PLUGIN_ROOT (and expand ${PLUGIN_ROOT}); run via bash or PowerShell.
//   - VS Code (Copilot and Local session targets): runs plugin hooks itself and does NOT provide the
//     plugin location for Agent Plugins 1.0 packages; commands run via /bin/sh, PowerShell or
//     cmd.exe, from the workspace or from /.
// So the command itself is a plain, shell-neutral `node -e 0 <plugin> <script>` (no quotes, no
// placeholders). A small bootstrap is preloaded through the hook's NODE_OPTIONS (`--import` of a
// data: URL). It uses PLUGIN_ROOT when the client provides it; otherwise it finds the installed copy of
// the plugin (VS Code agentPlugins copies, VS Code marketplace clones, Copilot CLI installs) and runs
// the script with stdin/stdout passed through. If the plugin can't be found it exits 0 silently.
//
// Usage: node tools/build-hooks.mjs          (write files)
//        node tools/build-hooks.mjs --check  (exit 1 if any hooks.json is out of date)
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Readable bootstrap source (an ES module). It travels inside NODE_OPTIONS as
// --import="data:text/javascript,<code>", so it must not contain: " \ # % ? $ ` or newlines.
const BOOTSTRAP_LINES = [
  "import f from 'node:fs'; import p from 'node:path'; import o from 'node:os'; import cp from 'node:child_process';",
  // With `node -e 0 <plugin> <script>`, argv is [node, plugin, script].
  'const [n, s] = process.argv.slice(1);',
  // A candidate is valid when it is absolute, its plugin.json has our name and the script exists.
  "const ok = (d) => { try { return p.isAbsolute(d) && JSON.parse(f.readFileSync(p.join(d, 'plugin.json'), 'utf8')).name === n && f.existsSync(p.join(d, s)) } catch (e) { return false } };",
  'const ls = (d) => { try { return f.readdirSync(d).map((x) => p.join(d, x)) } catch (e) { return [] } };',
  "const mtime = (d) => f.statSync(p.join(d, 'plugin.json')).mtimeMs;",
  'let root = null;',
  'if (process.env.PLUGIN_ROOT && ok(process.env.PLUGIN_ROOT)) { root = process.env.PLUGIN_ROOT } else {',
  '  const h = o.homedir(); const c = [];',
  // VS Code copies of enabled plugins: <user data>/agentPlugins/<id>/<version>
  "  for (const b of [p.join(h, 'Library', 'Application Support'), p.join(h, '.config'), process.env.APPDATA || h]) for (const v of ['Code', 'Code - Insiders']) for (const x of ls(p.join(b, v, 'agentPlugins'))) c.push(...ls(x));",
  // VS Code marketplace clones: ~/.vscode/agent-plugins/<host>/<owner>/<repo>/plugins/<name>
  "  for (const v of ['.vscode', '.vscode-insiders']) for (const a of ls(p.join(h, v, 'agent-plugins'))) for (const b of ls(a)) for (const x of ls(b)) c.push(p.join(x, 'plugins', n), p.join(x, n));",
  // Copilot CLI installs: ~/.copilot/installed-plugins/<marketplace>/<name>
  "  for (const x of ls(p.join(process.env.COPILOT_HOME || p.join(h, '.copilot'), 'installed-plugins'))) c.push(p.join(x, n));",
  '  root = c.filter(ok).sort((a, b) => mtime(b) - mtime(a))[0] || null;',
  '}',
  // The child must not inherit this NODE_OPTIONS, or it would run the bootstrap again.
  'if (root) { const env = Object.assign({}, process.env, { PLUGIN_ROOT: root }); delete env.NODE_OPTIONS;',
  "  const r = cp.spawnSync(process.execPath, [p.join(root, s)], { stdio: 'inherit', env: env }); process.exitCode = r.status || 0 }",
];
export const BOOTSTRAP = BOOTSTRAP_LINES.join(' ');

export const FORBIDDEN = /["\\#%?$`\n]/;
if (FORBIDDEN.test(BOOTSTRAP)) throw new Error(`bootstrap contains a forbidden character: ${JSON.stringify(FORBIDDEN.exec(BOOTSTRAP)[0])}`);

export const hookCommand = (plugin, script) => `node -e 0 ${plugin} scripts/${script}`;

const hook = (plugin, script, timeoutSec) => ({
  type: 'command',
  command: hookCommand(plugin, script),
  env: { NODE_OPTIONS: `--import="data:text/javascript,${BOOTSTRAP}"` },
  timeoutSec,
});

export const HOOKS = {
  'ship-ready': {
    sessionStart: [hook('ship-ready', 'session-context.mjs', 10)],
    postToolUse: [hook('ship-ready', 'audit-tool.mjs', 5)],
  },
  'secure-code-guardian': {
    sessionStart: [hook('secure-code-guardian', 'session-policy.mjs', 10)],
    preToolUse: [hook('secure-code-guardian', 'guard.mjs', 10)],
  },
  'docs-onboarding-buddy': {
    sessionStart: [hook('docs-onboarding-buddy', 'repo-map-context.mjs', 10)],
  },
};

export const render = (plugin) => `${JSON.stringify({ version: 1, hooks: HOOKS[plugin] }, null, 2)}\n`;
export const hooksPath = (plugin) => join(ROOT, 'plugins', plugin, 'com.github.copilot', 'hooks', 'hooks.json');

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const plugin of Object.keys(HOOKS)) {
    const file = hooksPath(plugin);
    const next = render(plugin);
    const current = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current === next) continue;
    if (check) {
      stale++;
      console.error(`✗ ${plugin}: hooks.json is out of date — run: node tools/build-hooks.mjs`);
    } else {
      writeFileSync(file, next);
      console.log(`✓ wrote ${file}`);
    }
  }
  if (check && !stale) console.log('✓ hooks.json files are up to date');
  process.exit(stale ? 1 : 0);
}
