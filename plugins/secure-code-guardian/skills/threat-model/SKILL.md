---
name: threat-model
description: Produce a lightweight STRIDE threat model for an application, service or feature — data-flow diagram (Mermaid), trust boundaries, threats with risk ratings and concrete mitigations. Use when asked for a threat model, security design review, attack surface analysis, or "what could go wrong" for a system or change.
license: MIT
metadata:
  plugin: secure-code-guardian
  version: "1.0.0"
---

# Threat Model (STRIDE)

Create a practical threat model that a development team can review in 10 minutes and act on immediately.

## When to use

- The user asks for a threat model, security design review, or attack-surface analysis.
- A new feature adds an entry point (API route, file upload, webhook, auth flow, third-party integration).
- Before a release that changes how data is stored, transmitted or authorized.

## Procedure

1. **Scope** – Name the system or feature under review in one sentence. If the user did not specify, model the whole repository at the service level.
2. **Discover the architecture** – Read the README/architecture docs, entry points (for example `api/src/index.ts`, route folders, `frontend/src/api`), data stores, and external calls. Note the tech stack.
3. **Draw the data flow** – Produce a Mermaid `flowchart LR` with actors, processes, data stores and external services. Mark **trust boundaries** with `subgraph` blocks (for example *Internet*, *App tier*, *Data tier*).
4. **Enumerate threats with STRIDE** – For each element that crosses a trust boundary, walk through [the STRIDE checklist](references/stride-checklist.md). Only keep threats that are plausible for *this* code; cite the file or component.
5. **Rate risk** – Use Likelihood (L/M/H) × Impact (L/M/H) → Risk: H×H or H×M = 🔴 High, M×M / H×L / L×H = 🟡 Medium, otherwise ⚪ Low.
6. **Mitigate** – For each threat, give one concrete mitigation that fits the stack (library, middleware, config setting, or code change) and state whether it already exists (✅) or is missing (❌).
7. **Write the report** – Use [the report template](references/report-template.md). Save it as `docs/threat-model.md` only if the user asks you to write files; otherwise return it in chat.

## Quality bar

- Every threat references a real component, route or file.
- At most ~12 threats; merge duplicates.
- End with the **top 3 mitigations** ranked by risk reduction per effort.
- Never include secret values in the report.

## Tip

If the Secure Code Guardian MCP server is available, run `scan_secrets` and `check_dependencies` first and fold their results into the *Information disclosure* and *Tampering / supply chain* sections.
