// Shared helpers for hook scripts. Hooks run in several harnesses (VS Code Local agent,
// Copilot CLI, Copilot app / Agent Host) which send slightly different payload shapes:
//   Copilot camelCase:   { toolName, toolArgs (often a JSON string), cwd, sessionId, prompt }
//   VS Code snake_case:  { tool_name, tool_input, cwd, session_id, hook_event_name, prompt }
// normalize() maps both to one shape so the hook logic is written once.
//
// NOTE: an identical copy of this file lives in every plugin, because Agent Plugins require
// every packaged file to stay inside its own plugin root.

import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export async function readPayload() {
  if (process.stdin.isTTY) return {};
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return { command: value };
  }
}

export function normalize(p = {}) {
  return {
    event: p.hook_event_name ?? p.hookEventName ?? null,
    sessionId: p.sessionId ?? p.session_id ?? null,
    cwd: p.cwd || process.cwd(),
    toolName: String(p.toolName ?? p.tool_name ?? ''),
    toolArgs: parseMaybeJson(p.toolArgs ?? p.tool_input ?? p.toolInput),
    toolResult: p.toolResult ?? p.tool_result ?? null,
    prompt: p.prompt ?? '',
    source: p.source ?? null,
  };
}

/** Collect every string inside the tool arguments, tagged with the key that held it. */
export function flattenStrings(value, key = '', out = []) {
  if (typeof value === 'string') out.push({ key, value });
  else if (Array.isArray(value)) value.forEach((v) => flattenStrings(v, key, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flattenStrings(v, k, out);
  }
  return out;
}

/** Emit a single JSON object understood by both Copilot (CLI/app) and VS Code hook runtimes. */
export function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

export function addContext(eventName, text) {
  emit({ additionalContext: text, hookSpecificOutput: { hookEventName: eventName, additionalContext: text } });
}

export function deny(reason) {
  emit({
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  });
}

export function dataDir(pluginName) {
  const dir = process.env.PLUGIN_DATA || join(homedir(), '.agent-plugins-demo', pluginName);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function audit(pluginName, record) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...record });
    appendFileSync(join(dataDir(pluginName), 'audit.log'), `${line}\n`);
  } catch {
    // Auditing must never break the agent.
  }
}
