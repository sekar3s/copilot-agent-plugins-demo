#!/usr/bin/env node
// preToolUse guardrail: blocks destructive shell commands and access to secret files
// before the agent can run them. Works with Copilot CLI, the Copilot app and VS Code.
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { readPayload, normalize, flattenStrings, deny, audit } from './lib/hook-io.mjs';

const PLUGIN = 'secure-code-guardian';

const SHELL_TOOL = /(^|_)(bash|shell|sh|zsh|powershell|pwsh|terminal|execute|run_command|runinterminal)($|_)|run_in_terminal|Bash/i;
// Exact argument names that hold file paths in Copilot CLI, VS Code and Claude-style tools.
// Content fields (file_text, content, newString) and search fields (pattern, glob, query) are ignored on purpose.
const PATH_KEYS = new Set(['path', 'paths', 'filepath', 'file_path', 'filepaths', 'uri', 'target_file', 'targetfile', 'source', 'destination', 'old_path', 'new_path', 'dir', 'directory']);

// Token-level secret file patterns (applied to a single path or shell word).
const SECRET_FILE = [
  { re: /(^|[/<>=:])\.env(?!\.(example|sample|template|dist)$)(\.[\w.*?-]*)?[*?]*$/i, what: '.env file' },
  { re: /(^|[/<>=:])id_(rsa|dsa|ecdsa|ed25519)[*?]*$/, what: 'SSH private key' },
  { re: /\.(pem|p12|pfx|key|keystore|jks)$/i, what: 'private key / certificate' },
  { re: /(^|[/<>=:])\.aws\/credentials$/, what: 'AWS credentials file' },
  { re: /(^|[/<>=:])\.npmrc$/, what: '.npmrc (may contain registry tokens)' },
  { re: /(^|[/<>=:])\.git-credentials$/, what: 'git credentials store' },
];

const COMMAND_RULES = [
  { id: 'force-push', re: /\bgit\s+push\b[^;&|\n]*?(\s--force(?!-with-lease)\b|\s-f\b|\s\+[\w/.-]+)/, why: 'Force-pushing rewrites shared history. Use a normal push or open a PR.' },
  {
    id: 'pipe-to-shell',
    // Shells and iex always execute stdin; python/node only when they read the script from stdin (no args or "-").
    re: /\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|\n]*\|\s*(sudo\s+)?((sh|bash|zsh|iex|Invoke-Expression)\b|(python3?|node)\s*(-\s*)?($|[;&|\n]))/i,
    why: 'Piping a remote script straight into a shell executes unreviewed code.',
  },
  { id: 'world-writable', re: /\bchmod\s+(-R\s+)?(0?777|a\+rwx)\b/, why: 'Making files world-writable is a security risk.' },
  { id: 'disk-wipe', re: /\b(mkfs(\.\w+)?\s|dd\s+[^\n]*\bof=\/dev\/(sd|disk|nvme|hd)|format\s+[a-z]:)/i, why: 'This command can destroy a disk.' },
  { id: 'fork-bomb', re: /:\(\)\s*\{\s*:\|:&\s*\};:/, why: 'Fork bomb detected.' },
];

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'pwsh', 'powershell', 'cmd']);
const PREFIX_CMDS = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'time', 'doas']);
const TEXT_CMDS = new Set(['echo', 'printf', 'write-output', 'write-host', 'say']);
const SEARCH_CMDS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'findstr', 'select-string']);
const RM_CMDS = new Set(['rm', 'del', 'erase', 'ri', 'rd', 'rmdir', 'remove-item']);
const CMD_FLAG_CMDS = new Set(['del', 'erase', 'rd', 'rmdir']); // cmd.exe style /s /q flags

const CRITICAL_TARGET = [
  /^(\/|\/\*|~|~\/|~\/\*|\*|\.|\.\/|\.\/\*|\.\.|\.\.\/|\.git\/?)$/,
  /^(\$home|\$\{home\}|\$env:userprofile|%userprofile%|\$env:homepath)(\/\*?)?$/i,
  /^\/(etc|usr|bin|sbin|var|lib|opt|system|library|applications|root|boot|dev|users|home)\/?\*?$/i,
  /^\/(users|home)\/[^/]+\/?\*?$/i,
  /^[a-z]:\/?\*?$/i,
  /^[a-z]:\/(windows|users|program files( \(x86\))?|programdata)(\/[^/]+)?\/?\*?$/i,
];

/** Split a shell command into words, honouring single and double quotes. */
export function tokenize(command) {
  const tokens = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) tokens.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
    }
  }
  if (has || cur) tokens.push(cur);
  return tokens;
}

const splitSegments = (command) => command.split(/&&|\|\||;|\||\r?\n/).map((s) => s.trim()).filter(Boolean);
const toSlash = (t) => (/^([a-z]:\\|\.{1,2}\\|\\\\)/i.test(t) ? t.replace(/\\/g, '/') : t);

function secretFileHit(token) {
  const t = toSlash(token);
  for (const rule of SECRET_FILE) if (rule.re.test(t)) return rule.what;
  return null;
}

/** Find the executable of a segment, skipping sudo/env prefixes and VAR=value assignments. */
function commandOf(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const base = t.split(/[\\/]/).pop().toLowerCase();
    if (/^[A-Za-z_]\w*=/.test(t)) i++;
    else if (PREFIX_CMDS.has(base)) {
      i++;
      while (i < tokens.length && tokens[i].startsWith('-')) i += /^-(u|g|C)$/.test(tokens[i]) ? 2 : 1;
    } else return { cmd: base.replace(/\.exe$/, ''), args: tokens.slice(i + 1) };
  }
  return { cmd: '', args: [] };
}

function checkRm(cmd, args) {
  if (!RM_CMDS.has(cmd)) return null;
  const isFlag = (a) => a.startsWith('-') || (CMD_FLAG_CMDS.has(cmd) && /^\/[a-z]$/i.test(a));
  const flags = args.filter(isFlag);
  const targets = args.filter((a) => !isFlag(a)).map((a) => toSlash(a.replace(/\\/g, '/')));
  const recursive = flags.some((f) => (/^-[a-zA-Z]{1,4}$/.test(f) && /r/i.test(f)) || /^--recursive$/i.test(f) || /^-rec(u(r(se?)?)?)?$/i.test(f) || /^\/s$/i.test(f));
  if (!recursive) return null;
  const bad = targets.find((t) => CRITICAL_TARGET.some((re) => re.test(t)));
  return bad ? `\`${cmd}\` would recursively delete a critical location (${bad}).` : null;
}

/** Evaluate a shell command string. Returns a deny result or null. */
function checkShell(command, depth = 0) {
  for (const rule of COMMAND_RULES) {
    if (rule.re.test(command)) return { decision: 'deny', rule: rule.id, reason: rule.why };
  }
  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);
    const { cmd, args } = commandOf(tokens);

    // Nested shells: bash -c "…", pwsh -Command "…"
    if (SHELLS.has(cmd) && depth < 2) {
      const idx = args.findIndex((a) => /^(-c|-lc|-ic|-command|\/c)$/i.test(a));
      if (idx >= 0 && args[idx + 1]) {
        const nested = checkShell(args.slice(idx + 1).join(' '), depth + 1);
        if (nested) return nested;
      }
    }

    const rm = checkRm(cmd, args);
    if (rm) return { decision: 'deny', rule: 'destructive-delete', reason: rm };

    // Decide which words could name a secret file for this command.
    let candidates;
    if (TEXT_CMDS.has(cmd)) {
      // echo/printf only matter when they redirect into a secret file.
      candidates = [];
      args.forEach((a, i) => {
        if (a === '>' || a === '>>') candidates.push(args[i + 1] ?? '');
        else if (a.includes('>')) candidates.push(a.slice(a.lastIndexOf('>') + 1));
      });
    } else {
      const skip = new Set();
      args.forEach((a, i) => {
        if (cmd === 'git' && /^(-m|-am|--message|-F|--file)$/.test(a)) skip.add(i + 1);
        if (cmd === 'find' && /^-(i?name|i?path|regex)$/.test(a)) skip.add(i + 1);
        if (SEARCH_CMDS.has(cmd) && /^(-e|--regexp|-pattern)$/i.test(a)) skip.add(i + 1);
      });
      if (SEARCH_CMDS.has(cmd) && !args.some((a) => /^(-e|--regexp|-pattern)$/i.test(a))) {
        const first = args.findIndex((a) => !a.startsWith('-'));
        if (first >= 0) skip.add(first);
      }
      candidates = args.filter((a, i) => !skip.has(i) && !/^--?message=/.test(a));
    }
    for (const c of candidates) {
      const secret = secretFileHit(c);
      if (secret) return { decision: 'deny', rule: 'secret-file', reason: `The command touches a ${secret}. Secrets must not be read or modified by the agent.` };
    }
  }
  return null;
}

/** Returns { decision: 'allow' } or { decision: 'deny', rule, reason }. Pure function for testing. */
export function evaluate({ toolName, toolArgs }) {
  const strings = flattenStrings(toolArgs);

  if (SHELL_TOOL.test(toolName)) {
    const commandParts = strings.filter((s) => /^(command|cmd|script|input|code|commandline)$/i.test(s.key));
    const command = (commandParts.length ? commandParts : strings).map((s) => s.value).join('\n');
    return checkShell(command) ?? { decision: 'allow' };
  }

  for (const s of strings) {
    if (!PATH_KEYS.has(s.key.toLowerCase())) continue;
    const secret = secretFileHit(s.value.replace(/\\/g, '/'));
    if (secret) return { decision: 'deny', rule: 'secret-file', reason: `Access to a ${secret} (${s.value}) is blocked. Secrets must not be read or modified by the agent.` };
  }
  return { decision: 'allow' };
}

async function main() {
  try {
    const input = normalize(await readPayload());
    const result = evaluate(input);
    if (result.decision === 'deny') {
      const reason = `🛡️ Secure Code Guardian blocked this ${input.toolName || 'tool'} call [${result.rule}]: ${result.reason}`;
      audit(PLUGIN, { event: 'preToolUse', decision: 'deny', rule: result.rule, tool: input.toolName, cwd: input.cwd });
      deny(reason);
    }
  } catch (err) {
    // Never crash: a crashing preToolUse hook denies *every* tool call in Copilot CLI.
    process.stderr.write(`[${PLUGIN}] guard error: ${err?.message ?? err}\n`);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
