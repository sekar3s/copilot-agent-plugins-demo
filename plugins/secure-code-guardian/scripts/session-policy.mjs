#!/usr/bin/env node
// sessionStart: tell the agent which security guardrails are active for this session.
import { readPayload, normalize, addContext, audit } from './lib/hook-io.mjs';

const PLUGIN = 'secure-code-guardian';

try {
  const input = normalize(await readPayload());
  audit(PLUGIN, { event: 'sessionStart', cwd: input.cwd, source: input.source });
  addContext(
    'SessionStart',
    [
      '🛡️ Secure Code Guardian is active for this session: a preToolUse guardrail hook enforces the team security policy on every tool call.',
      '- Never print, copy or commit secret values. Reference environment variable names instead.',
      '- For security questions, prefer the guardian MCP tools (scan_secrets, check_dependencies) and the threat-model skill.',
    ].join('\n'),
  );
} catch (err) {
  process.stderr.write(`[${PLUGIN}] session hook error: ${err?.message ?? err}\n`);
}
process.exit(0);
