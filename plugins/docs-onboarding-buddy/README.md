# 📚 Docs & Onboarding Buddy

Get a new teammate productive on day one. A **session hook** maps the repository automatically, the **onboarding-guide agent** explains the code with file links, the **codebase-tour skill** writes an `ONBOARDING.md`, and the **Microsoft Learn MCP server** answers platform questions from official docs.

| Component | Type | Where | What it does |
|---|---|---|---|
| `codebase-tour` | Skill (portable) | [`skills/codebase-tour/`](skills/codebase-tour/SKILL.md) | Guided tour: architecture diagram, run/test commands, "follow a request", conventions, good first tasks. Ships a zero-dependency [`repo-map.mjs`](skills/codebase-tour/scripts/repo-map.mjs) script. |
| `microsoft-learn` | MCP server (portable, **remote streamable-http**) | [`mcp.json`](mcp.json) | `https://learn.microsoft.com/api/mcp` — no auth, nothing to install. Tools: `microsoft_docs_search`, `microsoft_docs_fetch`, `microsoft_code_sample_search`. |
| `onboarding-guide` | Custom agent (Copilot) | [`com.github.copilot/agents/`](com.github.copilot/agents/onboarding-guide.agent.md) | Mentor persona that grounds every answer in code and cites Learn URLs |
| Repo map | Hook `sessionStart` (Copilot) | [`scripts/repo-map-context.mjs`](scripts/repo-map-context.mjs) | Injects stack, folders, entry points and docs into the agent's context. Reuses the skill's script, so the logic lives in one place. |

> This plugin shows the **second MCP transport**. The other two plugins bundle local `stdio` servers, and this one points at a hosted `streamable-http` endpoint. Both are portable Agent Plugins 1.0 `mcp.json` entries.

## Install

```bash
copilot plugin marketplace add sekar3s/copilot-agent-plugins-demo
copilot plugin install docs-onboarding-buddy@copilot-agent-plugins-demo
```

For VS Code and the GitHub Copilot app, see the [root README](../../README.md#-install).

## Try it

| Prompt | Shows |
|---|---|
| Select **onboarding-guide** → `Onboard me to this repo.` | Agent + hook context |
| `Give me a codebase tour and save it as ONBOARDING.md` | Skill `codebase-tour` |
| `Where is a product created, end to end?` | Grounded code navigation |
| `How do I deploy this to Azure Container Apps? Cite Microsoft Learn.` | Remote MCP (`microsoft-learn`) |

The CLI names plugin agents `<plugin>:<agent>`: `copilot --agent docs-onboarding-buddy:onboarding-guide`.
