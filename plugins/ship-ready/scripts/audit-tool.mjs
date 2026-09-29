#!/usr/bin/env node
// postToolUse: append every tool call to an audit trail (JSON lines) for compliance and demos.
// Log location: $PLUGIN_DATA/audit.log, or ~/.agent-plugins-demo/ship-ready/audit.log.
import { readPayload, normalize, audit } from './lib/hook-io.mjs';

try {
  const input = normalize(await readPayload());
  const args = input.toolArgs ?? {};
  const target = args.command ?? args.path ?? args.filePath ?? args.file_path ?? args.url ?? args.query ?? null;
  const result = input.toolResult ?? {};
  audit('ship-ready', {
    event: 'postToolUse',
    tool: input.toolName,
    target: typeof target === 'string' ? target.slice(0, 200) : null,
    result: result.resultType ?? result.result_type ?? null,
    cwd: input.cwd,
    session: input.sessionId,
  });
} catch {
  // Auditing must never interrupt the agent.
}
process.exit(0);
