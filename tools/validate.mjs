#!/usr/bin/env node
// Validates every plugin in this marketplace against the Agent Plugins 1.0 specification
// (official JSON schemas + the semantic rules that schemas cannot express) and the
// Copilot-specific component conventions. Run with: npm run validate
import { readFileSync, readdirSync, existsSync, statSync, realpathSync, lstatSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS_DIR = join(ROOT, 'plugins');
const schema = (f) => JSON.parse(readFileSync(join(ROOT, 'tools', 'schemas', f), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validatePlugin = ajv.compile(schema('plugin.schema.json'));
const validateMcp = ajv.compile(schema('mcp.schema.json'));

const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const SKILL_NAME = /^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$/;
const COPILOT_HOOK_EVENTS = new Set([
  'sessionStart', 'sessionEnd', 'userPromptSubmitted', 'userPromptTransformed', 'preToolUse', 'postToolUse',
  'postToolUseFailure', 'permissionRequest', 'agentStop', 'subagentStart', 'subagentStop', 'errorOccurred', 'preCompact', 'notification',
]);
const SHARED_LIBS = ['scripts/lib/hook-io.mjs', 'mcp/lib/mcp-stdio.mjs', 'mcp/lib/walk.mjs'];

let errors = 0;
let warnings = 0;
const err = (plugin, msg) => {
  errors++;
  console.log(`  ❌ ${plugin}: ${msg}`);
};
const warn = (plugin, msg) => {
  warnings++;
  console.log(`  ⚠️  ${plugin}: ${msg}`);
};
const ok = (msg) => console.log(`  ✅ ${msg}`);

const readJson = (file, plugin) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    err(plugin, `${relative(ROOT, file)} is not valid JSON (${e.message})`);
    return null;
  }
};

/** Minimal YAML front-matter reader for top-level `key: value` pairs. */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function checkContainment(pluginRoot, plugin) {
  const real = realpathSync(pluginRoot);
  const stack = [pluginRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (lstatSync(p).isSymbolicLink() && !realpathSync(p).startsWith(real)) err(plugin, `symlink escapes plugin root: ${relative(pluginRoot, p)}`);
      else if (statSync(p).isDirectory() && name !== 'node_modules') stack.push(p);
    }
  }
}

function checkPluginRootRefs(values, pluginRoot, plugin, where) {
  for (const v of values) {
    for (const m of String(v).matchAll(/\$\{PLUGIN_ROOT\}\/([^"'\s]+)/g)) {
      if (!existsSync(join(pluginRoot, m[1]))) err(plugin, `${where} references missing file \${PLUGIN_ROOT}/${m[1]}`);
    }
  }
}

function validateOne(pluginRoot) {
  const plugin = relative(PLUGINS_DIR, pluginRoot);
  console.log(`\n📦 ${plugin}`);
  const counts = { skills: 0, agents: 0, hooks: 0, mcp: 0 };

  // plugin.json
  const manifestPath = join(pluginRoot, 'plugin.json');
  if (!existsSync(manifestPath)) return err(plugin, 'missing plugin.json');
  const manifest = readJson(manifestPath, plugin);
  if (!manifest) return null;
  if (!validatePlugin(manifest)) {
    for (const e of validatePlugin.errors) err(plugin, `plugin.json ${e.instancePath || '/'} ${e.message}`);
  } else ok(`plugin.json valid (Agent Plugins 1.0) — ${manifest.name}@${manifest.version ?? 'unversioned'}`);
  if (manifest.$schema !== PLUGIN_SCHEMA) err(plugin, 'plugin.json $schema must be the Agent Plugins 1.0.0 identifier');
  if (manifest.name !== plugin) warn(plugin, `plugin name "${manifest.name}" differs from folder name`);

  // mcp.json
  const mcpPath = join(pluginRoot, 'mcp.json');
  if (existsSync(mcpPath)) {
    const mcp = readJson(mcpPath, plugin);
    if (mcp && !validateMcp(mcp)) {
      for (const e of validateMcp.errors) err(plugin, `mcp.json ${e.instancePath || '/'} ${e.message}`);
    } else if (mcp) {
      if (mcp.$schema !== MCP_SCHEMA) err(plugin, 'mcp.json $schema must match the plugin.json Agent Plugins version (1.0.0)');
      for (const [name, server] of Object.entries(mcp.mcpServers)) {
        counts.mcp++;
        if (server.type === 'stdio') {
          if (/\s/.test(server.command)) err(plugin, `mcp server "${name}": command must be a single executable token`);
          if (server.command.includes('${')) err(plugin, `mcp server "${name}": placeholders are not expanded in "command"`);
          if (server.command.startsWith('../')) err(plugin, `mcp server "${name}": command escapes the plugin root`);
          checkPluginRootRefs([...(server.args ?? []), ...Object.values(server.env ?? {})], pluginRoot, plugin, `mcp server "${name}"`);
        } else {
          const url = new URL(server.url);
          const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
          if (url.protocol !== 'https:' && !loopback) err(plugin, `mcp server "${name}": non-loopback URLs must use HTTPS`);
        }
      }
      ok(`mcp.json valid — ${Object.entries(mcp.mcpServers).map(([n, s]) => `${n} (${s.type})`).join(', ')}`);
    }
  }

  // skills/
  const skillsDir = join(pluginRoot, 'skills');
  if (existsSync(skillsDir)) {
    for (const dir of readdirSync(skillsDir)) {
      const skillFile = join(skillsDir, dir, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      counts.skills++;
      const fm = frontmatter(readFileSync(skillFile, 'utf8'));
      if (!fm) err(plugin, `skills/${dir}/SKILL.md has no YAML front matter`);
      else {
        if (fm.name !== dir) err(plugin, `skills/${dir}: front-matter name "${fm.name}" must equal the folder name`);
        if (!SKILL_NAME.test(fm.name ?? '')) err(plugin, `skills/${dir}: invalid skill name "${fm.name}"`);
        if (!fm.description || fm.description.length > 1024) err(plugin, `skills/${dir}: description is required (≤ 1024 chars)`);
        if (fm.name === dir && fm.description) ok(`skill "${dir}"`);
      }
    }
  }

  // com.github.copilot/agents
  const agentsDir = join(pluginRoot, 'com.github.copilot', 'agents');
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir).filter((x) => x.endsWith('.agent.md'))) {
      counts.agents++;
      const fm = frontmatter(readFileSync(join(agentsDir, f), 'utf8'));
      if (!fm?.description) err(plugin, `agents/${f}: front matter with a description is required`);
      else ok(`agent "${fm.name ?? f}"`);
    }
  }

  // com.github.copilot/hooks/hooks.json
  const hooksPath = join(pluginRoot, 'com.github.copilot', 'hooks', 'hooks.json');
  if (existsSync(hooksPath)) {
    const hooks = readJson(hooksPath, plugin);
    if (hooks) {
      if (hooks.version !== 1) err(plugin, 'hooks.json must declare "version": 1 (Copilot hook format)');
      for (const [event, entries] of Object.entries(hooks.hooks ?? {})) {
        if (!COPILOT_HOOK_EVENTS.has(event)) warn(plugin, `hooks.json: unknown event "${event}"`);
        if (!Array.isArray(entries)) err(plugin, `hooks.json: "${event}" must be an array`);
        for (const h of entries ?? []) {
          counts.hooks++;
          if (!h.bash && !h.powershell && !h.command && !h.exec && h.type !== 'prompt' && h.type !== 'http') err(plugin, `hooks.json: "${event}" entry needs bash/powershell/command`);
          if (h.bash && !h.powershell) warn(plugin, `hooks.json: "${event}" has no powershell variant (Windows users)`);
          checkPluginRootRefs([h.bash, h.powershell, h.command].filter(Boolean), pluginRoot, plugin, `hook "${event}"`);
        }
      }
      ok(`hooks.json valid — ${Object.keys(hooks.hooks ?? {}).join(', ')}`);
    }
  }

  checkContainment(pluginRoot, plugin);
  return { manifest, counts };
}

console.log('🔎 Validating Agent Plugins in', relative(process.cwd(), PLUGINS_DIR) || '.');
const results = new Map();
for (const name of readdirSync(PLUGINS_DIR)) {
  const dir = join(PLUGINS_DIR, name);
  if (statSync(dir).isDirectory()) results.set(name, validateOne(dir));
}

// Shared library copies must stay identical (each plugin carries its own copy for containment).
console.log('\n🔁 Shared library copies');
for (const lib of SHARED_LIBS) {
  const copies = [...results.keys()].map((p) => join(PLUGINS_DIR, p, lib)).filter(existsSync);
  const contents = new Set(copies.map((c) => readFileSync(c, 'utf8')));
  if (contents.size > 1) err('shared-libs', `${lib} differs between plugins: ${copies.map((c) => relative(ROOT, c)).join(', ')}`);
  else if (copies.length) ok(`${lib} identical in ${copies.length} plugin(s)`);
}

// Marketplace manifest
console.log('\n🏪 Marketplace');
const mpPath = join(ROOT, '.github', 'plugin', 'marketplace.json');
const mp = readJson(mpPath, 'marketplace');
if (mp) {
  if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(mp.name ?? '')) err('marketplace', 'name must be kebab-case (≤ 64 chars)');
  if (!mp.owner?.name) err('marketplace', 'owner.name is required');
  const listed = new Set();
  for (const entry of mp.plugins ?? []) {
    listed.add(entry.name);
    const src = join(ROOT, entry.source);
    const res = results.get(entry.name);
    if (!existsSync(join(src, 'plugin.json'))) err('marketplace', `${entry.name}: source ${entry.source} has no plugin.json`);
    else if (res?.manifest?.name !== entry.name) err('marketplace', `${entry.name}: name does not match plugin.json`);
    else if (res.manifest.version !== entry.version) err('marketplace', `${entry.name}: version ${entry.version} ≠ plugin.json ${res.manifest.version}`);
    else ok(`${entry.name}@${entry.version} → ${entry.source}`);
  }
  for (const name of results.keys()) if (!listed.has(name)) warn('marketplace', `plugin "${name}" is not listed in marketplace.json`);
}

console.log('\n📊 Summary');
console.log('| Plugin | Skills | Agents | Hooks | MCP servers |');
console.log('|---|---|---|---|---|');
for (const [name, r] of results) if (r) console.log(`| ${name} | ${r.counts.skills} | ${r.counts.agents} | ${r.counts.hooks} | ${r.counts.mcp} |`);
console.log(`\n${errors ? '❌' : '✅'} ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
