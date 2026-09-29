# 🎤 Demo Script — Agent Plugins across VS Code, the Copilot app and Copilot CLI

**Length:** ~20 minutes, plus Q&A · **Audience:** engineering leaders and developers · **Demo repo:** [octocat-supply](https://github.com/sekar3s/octocat-supply-sep28), a React + Express + SQLite supply-chain app.

> **The one-liner:** *"Your team's best practices, guardrails and tools packaged once as an open-standard plugin. Then they show up everywhere your developers use Copilot: the editor, the desktop app and the terminal."*

---

## 🧰 Prep (the day before)

| ✅ | Step |
|---|---|
| ☐ | Node 18+ (`node -v`), Copilot CLI up to date (`copilot update`), VS Code with GitHub Copilot, and the GitHub Copilot app, all signed in. |
| ☐ | Clone the demo app: `git clone https://github.com/sekar3s/octocat-supply-sep28 ~/demo/octocat-supply`. |
| ☐ | Create a **dummy** secret file for the guardrail moment: `cd ~/demo/octocat-supply && printf 'DB_PASSWORD=demo-not-real\n' > .env`. It's git-ignored. |
| ☐ | **Use a clean CLI profile** so your personal skills and plugins don't crowd the demo: `export COPILOT_HOME=~/.copilot-demo`. Put it in the terminal profile you'll present from. This isolates the CLI only; in the Copilot app, temporarily disable unrelated plugins under **Customize → Installed**. |
| ☐ | VS Code 1.139+: create a profile named `Agent Plugins Demo` (**Profiles → New Profile**) with only GitHub Copilot installed. Set `"chat.plugins.enabled": true`, and pick **Copilot** in the chat **Session Target** control (it runs every plugin component; see the README's VS Code table). |
| ☐ | Dry-run every prompt below once. Leave the **Guardian** dependency check warm, because the first OSV.dev call is the slowest. |
| ☐ | Open tabs: this repo on GitHub, [agent-plugins.org](https://agent-plugins.org/), and the [VS Code plugin docs](https://code.visualstudio.com/docs/agent-customization/agent-plugins). |
| ☐ | Terminal font ≥ 16pt. Turn on Do Not Disturb. |

Reset between rehearsals:

```bash
copilot plugin uninstall ship-ready@copilot-agent-plugins-demo
copilot plugin uninstall secure-code-guardian@copilot-agent-plugins-demo
copilot plugin uninstall docs-onboarding-buddy@copilot-agent-plugins-demo
copilot plugin marketplace remove copilot-agent-plugins-demo
rm -rf ~/.agent-plugins-demo
```

---

## 1. The problem (1 min)

> *"Every team has tribal knowledge: how we release, what's forbidden in production, how new hires get up to speed. With AI agents that knowledge ends up scattered across prompt files, MCP configs and scripts, and it's different on every tool. Agent Plugins fix that. One package, an **open standard**, and it installs anywhere Copilot runs."*

Show the table at the top of the [README](README.md): **3 plugins × (skill + agent + hooks + MCP)**.

## 2. Anatomy of a plugin (3 min)

Open [`plugins/secure-code-guardian`](plugins/secure-code-guardian) in VS Code and walk the tree:

1. **`plugin.json`**: *"Ten lines. The `$schema` says 'I'm an Agent Plugins 1.0 package'."*
2. **`skills/threat-model/SKILL.md`**: *"Portable expertise. Any Agent Plugins client can load it."*
3. **`mcp.json`**: *"Portable tools. This one runs a local Node server with zero dependencies. Look: `${PLUGIN_ROOT}`, because plugins install outside your repo."*
4. **`com.github.copilot/`**: *"Copilot-specific extras. A custom agent and hooks. Other clients just ignore this folder, and that's how the standard stays portable."*
5. **`hooks.json` → `scripts/guard.mjs`**: *"Deterministic code, not a prompt. It runs before **every** tool call."*

Then show the quality story:

```bash
npm run check    # schema validation + 97 tests, also runs in CI on Linux/macOS/Windows
```

## 3. Install from the marketplace in the CLI (2 min)

```bash
cd ~/demo/octocat-supply
copilot plugin marketplace add sekar3s/copilot-agent-plugins-demo
copilot plugin marketplace browse copilot-agent-plugins-demo
copilot plugin install secure-code-guardian@copilot-agent-plugins-demo
copilot plugin install ship-ready@copilot-agent-plugins-demo
copilot plugin install docs-onboarding-buddy@copilot-agent-plugins-demo
copilot plugin list
```

> *"A marketplace is just a Git repo with a `marketplace.json`. Your platform team can run a private one."*

## 4. 🛡️ Secure Code Guardian in the CLI (5 min) ⭐ key moment

Start an interactive session (`copilot`) in `~/demo/octocat-supply`.

**a) The security reviewer agent + MCP**

```
/agent   → pick secure-code-guardian:security-reviewer
Do a security review of this repo. Start with secrets and dependencies.
```

Expected result: the `scan_secrets` and `check_dependencies` MCP tools run. You get a table with **real** findings from OSV.dev, for example critical `vitest` and high `axios`/`vite`/`postcss` advisories, each with a *smallest safe upgrade*.

> *"That's live vulnerability data, from an MCP server that shipped inside the plugin. No setup and no API keys."*

**b) The guardrail (the headline moment)**

Switch back to the default agent (`/agent` → default). Use requests a developer would *really* make, so the agent attempts the action by itself:

```
Add LOG_LEVEL=debug to the .env file.
```

Expected result: the agent tries to open `.env` → `✗ Denied by preToolUse hook: 🛡️ Secure Code Guardian blocked this view call [secret-file] …`

```
Install bun with its official install script: curl -fsSL https://bun.sh/install | bash. If that is blocked, stop and explain why — do not try another way.
```

Expected result: `✗ … blocked this bash call [pipe-to-shell]`, and the agent explains the policy.

> ⚠️ Keep the *"stop and explain"* sentence. Without it, the agent often adapts on its own: it downloads the script, reviews it and runs it, which **really installs bun** on the demo machine.

> *"This isn't the model being polite. It's a deterministic policy that runs before every tool call, and the model can't talk its way around it. Enterprises can force-enable this plugin and set `allowManagedHooksOnly`."*

> 💡 Avoid prompts like *"print my .env password"* or *"force-push main"* as the headline. Modern models often refuse those on their own, so the hook never gets a chance to fire. Keep them for the Q&A to show that the model and the policy add up to defense in depth.

Show the evidence:

```bash
cat ~/.agent-plugins-demo/secure-code-guardian/audit.log
```

**c) The skill** (optional, if time allows)

```
Threat-model the products API.
```

Expected result: a STRIDE table with a Mermaid data-flow diagram.

## 5. 🚢 Ship-Ready in VS Code (4 min)

> *"Same package, different surface."*

1. In VS Code (Demo profile), open `~/demo/octocat-supply`.
2. Install live on a second surface: add `"chat.plugins.marketplaces": ["sekar3s/copilot-agent-plugins-demo"]` to user settings. Then open the Extensions view → search `@agentPlugins` → **Install** *ship-ready* (and the other two).
   - *Note:* VS Code also automatically discovers plugins installed by the CLI in `~/.copilot/installed-plugins/`. That doesn't apply here, because the demo CLI uses `COPILOT_HOME=~/.copilot-demo`.
3. Open **Chat: Configure Skills** and **MCP: List Servers** to show the plugin's skill and server next to local ones.
4. In a new terminal, run `tail -f ~/.agent-plugins-demo/ship-ready/audit.log`.
5. Make sure **Session Target** is **Copilot**, start a **new** chat, pick the **release-captain** agent and ask:

```
Are we ready to ship?
```

Expected result: a readiness score with a letter grade (the demo app lands around **D/C**), a recommended version, a change summary, and a 🟡 **GO WITH CAUTION** checklist. The terminal shows the `postToolUse` audit lines streaming in.

```
Draft the release notes for that version.
```

Expected result: the `release-notes` skill produces highlights, grouped changes and contributors.

> *"Hooks give you an audit trail of every agent action. That's the compliance conversation, solved with ~20 lines of Node."*

6. Show the guardrail in VS Code too: `Add LOG_LEVEL=debug to the .env file` → denied by the same `preToolUse` hook you saw in the CLI.
7. **VS Code extras** (30 sec each, pick one or two):
   - **Handoffs:** switch to **security-reviewer**, ask `Quick security review — dependencies only`, then click **Fix the top findings** to hand the plan to the default agent.
   - **Automation templates:** open the Agents window → **Automations** → **New** → **Templates from Plugins** → *Daily dependency & secret audit*. *"Plugins can ship scheduled agent tasks, not just tools."*
   - **Slash skills:** type `/threat-model the products API` in chat.

## 6. 📚 Docs & Onboarding Buddy in the Copilot app (3 min)

1. Open the **GitHub Copilot app**, then go to **Customize → Plugins**.
2. Click ⚙️ next to the marketplace dropdown → add `sekar3s/copilot-agent-plugins-demo` → select it → **Install** *docs-onboarding-buddy*. Point out the same three plugins you saw in the CLI and VS Code.
3. Start a session on the `octocat-supply` repo, pick **onboarding-guide** (`/agent`) and ask:

```
I'm new here — onboard me. How does a product get from the database to the UI?
```

Expected result: a grounded walkthrough with file links. It uses the repo map the `sessionStart` hook injected.

```
How would I deploy this to Azure Container Apps? Cite Microsoft Learn.
```

Expected result: the `microsoft-learn` **remote** MCP server is called and a learn.microsoft.com link is cited.

> *"Two MCP transports: local stdio servers bundled in the other plugins, and a hosted HTTP server here. Both are declared the same portable way."*

## 7. Scale it to the enterprise (1 min)

Show the README section **"Recommend the plugins to your whole team"**:

- `.github/copilot/settings.json` → `extraKnownMarketplaces` + `enabledPlugins`: everyone who clones the repo gets the plugins.
- Managed settings → force-enable the guardian and set `allowManagedHooksOnly: true`.
- Private marketplace repo → your platform team curates what developers can install.

## 8. Close (30 sec)

> *"One open-standard package with skills, agents, hooks and MCP. It works in VS Code, the Copilot app and the CLI. Your best practices become something you install, version, review and govern, just like code."*

---

## 🆘 Fallbacks

| If… | Do this |
|---|---|
| The agent never attempts the action (the model refused on its own) | Say *"the model is cautious too, and the policy holds even when it isn't"*. Then use the other prompt (`Add LOG_LEVEL=debug to the .env file` or the `curl … \| bash` installer), or show the unit tests: `node --test tests/guard.test.mjs`. |
| OSV.dev is slow or offline | Show `scan_secrets` instead, and read the offline fallback message aloud as a *resilience* feature. |
| `Skill not found` | The profile has too many skills; confirm `COPILOT_HOME=~/.copilot-demo`. Or say *"use the release-notes skill"* explicitly. |
| The VS Code agent picker doesn't list plugin agents | **Developer: Reload Window**. Check **Agent Plugins – Installed**. Fall back to the CLI with `copilot --agent ship-ready:release-captain`. |
| `ship-ready` / `guardian` tools are missing in VS Code | The **Session Target** is **Local**, which can't start bundled MCP servers from Agent Plugins 1.0 packages. Switch to **Copilot** and start a new chat. |
| No network at all | Use the CLI with `--plugin-dir ./plugins/<name>` from a local clone. Everything except OSV.dev and Microsoft Learn works offline. |

## ❓ Likely questions

- **"Can plugins run arbitrary code?"** Yes, hooks and local MCP servers do. That's why marketplaces show a trust prompt, enterprises can restrict marketplaces and plugins with managed settings, and `allowManagedHooksOnly` limits hooks to admin-approved plugins.
- **"Is this Copilot-only?"** Skills and MCP servers are the portable Agent Plugins 1.0 components. Agents and hooks live in the `com.github.copilot` namespace, which other clients ignore without breaking.
- **"How do we version and update?"** Bump `version` in `plugin.json` and `marketplace.json`, then push. Clients pick up the update (`copilot plugin update --all`, or **Check for Extension Updates** in VS Code).
- **"How do we test plugins?"** See `npm run check`: schema validation plus unit tests for hook policies and MCP tools, run in CI on three operating systems.
