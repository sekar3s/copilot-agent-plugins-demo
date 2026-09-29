# 🛡️ Secure Code Guardian

Security guardrails that travel with the developer: a **hook** that blocks dangerous agent actions before they happen, an **MCP server** that finds secrets and vulnerable dependencies, a read-only **security-reviewer agent**, and a **threat-model skill**.

| Component | Type | Where | What it does |
|---|---|---|---|
| `threat-model` | Skill (portable) | [`skills/threat-model/`](skills/threat-model/SKILL.md) | STRIDE threat model with Mermaid data-flow diagram, risk ratings and mitigations |
| `guardian` | MCP server (portable, local stdio, zero dependencies) | [`mcp.json`](mcp.json) → [`mcp/server.mjs`](mcp/server.mjs) | `scan_secrets` (masked output) · `check_dependencies` (live [OSV.dev](https://osv.dev) lookup for npm + PyPI) |
| `security-reviewer` | Custom agent (Copilot) | [`com.github.copilot/agents/`](com.github.copilot/agents/security-reviewer.agent.md) | Read-only reviewer: secrets → dependencies → OWASP Top 10 → prioritized table |
| Guardrail | Hook `preToolUse` (Copilot) | [`com.github.copilot/hooks/hooks.json`](com.github.copilot/hooks/hooks.json) → [`scripts/guard.mjs`](scripts/guard.mjs) | **Denies** `rm -rf` on critical paths, `git push --force`, `curl … \| sh`, `chmod 777`, disk wipes, and any access to `.env`, private keys, `.npmrc`, cloud credentials |
| Security policy | Hook `sessionStart` (Copilot) | [`scripts/session-policy.mjs`](scripts/session-policy.mjs) | Tells the agent the guardrails are active and to never echo secrets |

## Install

```bash
# Copilot CLI (and the GitHub Copilot app, which shares the CLI's plugins)
copilot plugin marketplace add sekar3s/copilot-agent-plugins-demo
copilot plugin install secure-code-guardian@copilot-agent-plugins-demo
```

VS Code: add `"chat.plugins.marketplaces": ["sekar3s/copilot-agent-plugins-demo"]` to your settings, then search `@agentPlugins guardian` in the Extensions view and select **Install**. See the [root README](../../README.md#-install) for all options.

## Try it

| Surface | Prompt |
|---|---|
| Any (agent) | Select **security-reviewer** → `Do a security review of this repo.` |
| Any (guardrail) | `Show me what's in the .env file` → blocked by the hook |
| Any (guardrail) | `Force-push my branch to origin` → blocked by the hook |
| Any (skill) | `Create a threat model for the API.` |
| Any (MCP) | `Which of our dependencies have known vulnerabilities?` |

The CLI names plugin agents `<plugin>:<agent>`, e.g. `copilot --agent secure-code-guardian:security-reviewer`.

## How the guardrail works

1. Before every tool call, the runtime pipes the call to `node scripts/guard.mjs` on stdin.
2. The script normalizes the two payload shapes: Copilot CLI/app send `toolName`/`toolArgs`, and VS Code sends `tool_name`/`tool_input`. It then checks the policy.
3. To deny, it prints one JSON object that both runtimes understand:
   ```json
   { "permissionDecision": "deny", "permissionDecisionReason": "…",
     "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "…" } }
   ```
4. The script never crashes. A crashing `preToolUse` command hook would *deny every tool* in Copilot CLI.
5. Every denial is appended to `~/.agent-plugins-demo/secure-code-guardian/audit.log` (or `$PLUGIN_DATA/audit.log`).

To extend the policy, edit `COMMAND_RULES` / `SECRET_FILE` in [`scripts/guard.mjs`](scripts/guard.mjs), then add a case to [`tests/guard.test.mjs`](../../tests/guard.test.mjs).

## Notes

- `check_dependencies` needs internet access to `api.osv.dev`. If it can't reach the service, it reports that clearly instead of failing.
- Add `guardian:ignore` to a line to suppress a known false positive in `scan_secrets`.
