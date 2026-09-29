# 🚢 Ship-Ready

A release-readiness toolkit. It scores your repository, recommends the next semantic version, writes release notes people actually read, and keeps an audit trail of every tool call the agent makes.

| Component | Type | Where | What it does |
|---|---|---|---|
| `release-notes` | Skill (portable) | [`skills/release-notes/`](skills/release-notes/SKILL.md) | Turns commits into audience-friendly notes (highlights, breaking changes + migration, contributors). Ships a self-contained [`collect-commits.mjs`](skills/release-notes/scripts/collect-commits.mjs) script. |
| `ship-ready` | MCP server (portable, local stdio, zero dependencies) | [`mcp.json`](mcp.json) → [`mcp/server.mjs`](mcp/server.mjs) | `readiness_scan` (0–100 score + grade across docs, security, quality, delivery) · `changelog_from_git` · `suggest_version_bump` |
| `release-captain` | Custom agent (Copilot) | [`com.github.copilot/agents/`](com.github.copilot/agents/release-captain.agent.md) | Readiness → version → changes → release notes → 🟢/🟡/🔴 go/no-go |
| Release context | Hook `sessionStart` (Copilot) | [`scripts/session-context.mjs`](scripts/session-context.mjs) | Adds branch, ahead/behind, uncommitted changes and commits since the last tag to the agent's context |
| Audit trail | Hook `postToolUse` (Copilot) | [`scripts/audit-tool.mjs`](scripts/audit-tool.mjs) | Appends every tool call (tool, target, result) as JSON lines to `~/.agent-plugins-demo/ship-ready/audit.log` |

## Install

```bash
copilot plugin marketplace add sekar3s/copilot-agent-plugins-demo
copilot plugin install ship-ready@copilot-agent-plugins-demo
```

For VS Code and the GitHub Copilot app, see the [root README](../../README.md#-install).

## Try it

| Prompt | Shows |
|---|---|
| Select **release-captain** → `Are we ready to ship?` | Agent + MCP + skill working together |
| `What's our release readiness score?` | MCP tool `readiness_scan` |
| `Draft release notes for v1.1.0` | Skill `release-notes` |
| `What version should we release next?` | MCP tool `suggest_version_bump` |
| `tail -f ~/.agent-plugins-demo/ship-ready/audit.log` in a terminal | `postToolUse` hook auditing live |

The CLI names plugin agents `<plugin>:<agent>`: `copilot --agent ship-ready:release-captain`.

## Readiness checks

| Area | Checks (weight) |
|---|---|
| Docs | README with content (10) · LICENSE (5) · CHANGELOG (5) · CONTRIBUTING (3) |
| Security | SECURITY.md (5) · no tracked `.env` (7) · `.gitignore` covers `.env`/deps (3) · Dependabot/Renovate (5) |
| Quality | Tests present (12) · test ratio ≥ 0.2 (5) · build/test/lint scripts (8) · ≤ 10 TODO/FIXME (5) |
| Delivery | CI workflow (10) · lockfile (5) · clean working tree (7) · CODEOWNERS (3) |

Grade: A ≥ 90 · B ≥ 80 · C ≥ 70 · D ≥ 60 · F < 60.
