// Minimal, dependency-free Model Context Protocol (MCP) server over stdio.
// Implements the subset needed for tools: initialize, ping, tools/list, tools/call.
// Messages are newline-delimited JSON-RPC 2.0. Only stderr is used for logging,
// because stdout is reserved for protocol messages.
//
// NOTE: an identical copy of this file lives in every plugin that bundles a local MCP server,
// because Agent Plugins require every packaged file to stay inside its own plugin root.

import { createInterface } from 'node:readline';

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export function createServer({ name, version, instructions, tools }) {
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  const log = (...args) => process.stderr.write(`[${name}] ${args.join(' ')}\n`);

  async function handle(msg) {
    const { id, method, params = {} } = msg;
    const isRequest = id !== undefined && id !== null;

    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0];
        return reply(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
          ...(instructions ? { instructions } : {}),
        });
      }
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, {
          tools: tools.map(({ name: n, title, description, inputSchema, annotations }) => ({
            name: n,
            ...(title ? { title } : {}),
            description,
            inputSchema,
            ...(annotations ? { annotations } : {}),
          })),
        });
      case 'tools/call': {
        const tool = toolMap.get(params.name);
        if (!tool) return fail(id, -32602, `Unknown tool: ${params.name}`);
        try {
          const text = await tool.handler(params.arguments ?? {});
          return reply(id, { content: [{ type: 'text', text: String(text) }] });
        } catch (err) {
          log(`tool ${params.name} failed:`, err?.stack ?? err);
          return reply(id, {
            content: [{ type: 'text', text: `Error: ${err?.message ?? err}` }],
            isError: true,
          });
        }
      }
      default:
        // Notifications (no id) such as notifications/initialized are acknowledged silently.
        if (isRequest) return fail(id, -32601, `Method not found: ${method}`);
    }
  }

  return {
    start() {
      const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return fail(null, -32700, 'Parse error');
        }
        for (const m of Array.isArray(msg) ? msg : [msg]) {
          handle(m).catch((err) => {
            log('unhandled error:', err?.stack ?? err);
            if (m.id !== undefined) fail(m.id, -32603, 'Internal error');
          });
        }
      });
      rl.on('close', () => process.exit(0));
      log(`v${version} ready (plugin root: ${process.env.PLUGIN_ROOT ?? 'unknown'})`);
    },
  };
}

// Plugin MCP servers start in the plugin folder, not in the user's repository, so every tool
// accepts an explicit `path`. The agent passes its current working directory.
export function resolveTargetPath(inputPath) {
  if (inputPath) return inputPath;
  const cwd = process.cwd();
  if (process.env.PLUGIN_ROOT && cwd === process.env.PLUGIN_ROOT) {
    throw new Error(
      'Pass the absolute path of the repository to analyze in the "path" argument (this server runs from the plugin folder).',
    );
  }
  return cwd;
}
