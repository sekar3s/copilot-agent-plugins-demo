#!/usr/bin/env node
// Runs an installed plugin hook exactly like VS Code does (no PLUGIN_ROOT, run from the current folder)
// and prints its output. Usage: node tools/try-hook.mjs <plugin> <event>
// Example: node tools/try-hook.mjs secure-code-guardian preToolUse   → should print a "deny" decision.
import { spawnSync } from 'node:child_process';
import { HOOKS } from './build-hooks.mjs';

const [plugin = 'secure-code-guardian', event = 'preToolUse'] = process.argv.slice(2);
const entry = HOOKS[plugin]?.[event]?.[0];
if (!entry) {
  console.error(`No ${event} hook in ${plugin}. Available: ${Object.entries(HOOKS).map(([p, h]) => `${p} (${Object.keys(h).join(', ')})`).join('; ')}`);
  process.exit(1);
}
const payload = { sessionId: 'try-hook', toolName: 'bash', toolArgs: JSON.stringify({ command: 'cat .env' }), source: 'new' };
const env = { ...process.env, ...entry.env };
delete env.PLUGIN_ROOT;
const r = spawnSync(entry.command, { shell: true, input: JSON.stringify(payload), encoding: 'utf8', env });
console.log(`exit ${r.status}`);
console.log(r.stdout.trim() || '(no output — the plugin was not found in any VS Code or Copilot CLI install location)');
if (r.stderr.trim()) console.error(r.stderr.trim());
