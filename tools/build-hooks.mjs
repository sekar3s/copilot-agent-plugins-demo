#!/usr/bin/env node
// Generates com.github.copilot/hooks/hooks.json for every plugin.
//
// Why a generator? Each hook command must work in every place a Copilot client runs hooks:
//   - Copilot CLI / Copilot app: replaces ${PLUGIN_ROOT} with the plugin folder (bash or PowerShell).
//   - VS Code (Copilot and Local session targets): runs plugin hooks itself and does NOT expand
//     ${PLUGIN_ROOT} for Agent Plugins 1.0 packages; commands run from the workspace via
//     /bin/sh, PowerShell or cmd.exe.
// So every command is a shell-neutral `node -e "<bootstrap>" <plugin> <script> "${PLUGIN_ROOT}"`.
// The bootstrap uses the expanded ${PLUGIN_ROOT} when it is available, otherwise it finds the
// installed copy of the plugin (VS Code agentPlugins, VS Code marketplace clones, Copilot CLI
// installs) and runs the script with stdin/stdout passed through.
//
// Usage: node tools/build-hooks.mjs          (write files)
//        node tools/build-hooks.mjs --check  (exit 1 if any hooks.json is out of date)
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Readable source of the bootstrap. It is joined into one line, so it must not contain characters
// that bash, PowerShell or cmd.exe would interpret inside double quotes: " $ ` % \
const BOOTSTRAP_LINES = [
  "const f=require('fs'),p=require('path'),o=require('os');",
  // The root goes last: Windows PowerShell 5.1 drops empty arguments, which would shift the others.
  'const [n,s,r]=process.argv.slice(1);',
  // A candidate is valid when its plugin.json has our name and the script exists.
  "const ok=d=>{try{return JSON.parse(f.readFileSync(p.join(d,'plugin.json'),'utf8')).name===n&&f.existsSync(p.join(d,s))}catch(e){return false}};",
  "const ls=d=>{try{return f.readdirSync(d).map(x=>p.join(d,x))}catch(e){return []}};",
  // Only trust an absolute root; an unexpanded literal like ${PLUGIN_ROOT} would resolve inside the workspace.
  'let root=r&&p.isAbsolute(r)&&ok(r)?r:null;',
  'if(!root){',
  "const h=o.homedir(),c=[];",
  // VS Code copies of enabled plugins: <user data>/agentPlugins/<id>/<version>
  "for(const b of [p.join(h,'Library','Application Support'),p.join(h,'.config'),process.env.APPDATA||h])for(const v of ['Code','Code - Insiders'])for(const x of ls(p.join(b,v,'agentPlugins')))c.push(...ls(x));",
  // VS Code marketplace clones: ~/.vscode/agent-plugins/<host>/<owner>/<repo>/plugins/<name>
  "for(const v of ['.vscode','.vscode-insiders'])for(const a of ls(p.join(h,v,'agent-plugins')))for(const b of ls(a))for(const x of ls(b))c.push(p.join(x,'plugins',n),p.join(x,n));",
  // Copilot CLI installs: ~/.copilot/installed-plugins/<marketplace>/<name>
  "for(const x of ls(p.join(process.env.COPILOT_HOME||p.join(h,'.copilot'),'installed-plugins')))c.push(p.join(x,n));",
  "root=c.filter(d=>p.isAbsolute(d)&&ok(d)).sort((a,b)=>f.statSync(p.join(b,'plugin.json')).mtimeMs-f.statSync(p.join(a,'plugin.json')).mtimeMs)[0];",
  '}',
  // Missing plugin: exit 0 so a hook never blocks the agent by accident.
  "if(root){const x=require('child_process').spawnSync(process.execPath,[p.join(root,s)],{stdio:'inherit',env:Object.assign({},process.env,{PLUGIN_ROOT:root})});process.exitCode=x.status||0}",
];
export const BOOTSTRAP = BOOTSTRAP_LINES.join('');

const FORBIDDEN = /["$`%\\]/;
if (FORBIDDEN.test(BOOTSTRAP)) throw new Error(`bootstrap contains a shell-sensitive character: ${FORBIDDEN.exec(BOOTSTRAP)[0]}`);

export const hookCommand = (plugin, script) => `node -e "${BOOTSTRAP}" ${plugin} scripts/${script} "\${PLUGIN_ROOT}"`;

const hook = (plugin, script, timeoutSec) => ({ type: 'command', command: hookCommand(plugin, script), timeoutSec });

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
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
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
