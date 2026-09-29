---
name: codebase-tour
description: Generate a guided onboarding tour of a repository — architecture diagram, how to run and test, key files and request flow, conventions, and good first tasks — saved as ONBOARDING.md. Use when someone asks to be onboarded, wants a codebase tour or overview, or asks "how does this project work?".
license: MIT
metadata:
  plugin: docs-onboarding-buddy
  version: "1.1.0"
---

# Codebase Tour

Produce an onboarding guide that lets a new developer run the project, understand its architecture and ship a first change on day one.

## Step 1 — Map the repository

Run the bundled script (Node ≥ 18, no dependencies) from the repository root:

```bash
node <this-skill-folder>/scripts/repo-map.mjs --repo .
```

It prints the stack, top-level folders with languages, likely entry points, package scripts and docs to read first. Add `--json` for machine-readable output.

## Step 2 — Read the essentials

Read, in this order, only as much as you need:

1. `README.md` and anything under `docs/` that mentions architecture, build or deployment.
2. Each entry point from the map (for example `api/src/index.ts`, `frontend/src/main.tsx`).
3. One representative feature end-to-end: route → service/repository → data store, and UI component → API call.
4. Test setup (test config and one representative test).

## Step 3 — Write the tour

Follow [the ONBOARDING template](references/onboarding-template.md). Requirements:

- A Mermaid `flowchart` of the main components and how requests flow.
- Exact, copy-pasteable commands to install, run, test and lint — taken from the real scripts.
- A **"Follow a request"** walkthrough with file links in call order.
- **Conventions** you observed (naming, error handling, folder layout, commit style).
- **3 good first tasks**, each with the file(s) to touch and why it is a safe starter.
- A glossary of domain terms found in the code.

## Step 4 — Deliver

- Save to `ONBOARDING.md` at the repository root when the user asked for a file; otherwise return it in chat.
- Finish with a one-paragraph "If you only read one thing…" summary.

## Quality bar

- Every file reference must exist — verify paths before writing them.
- Prefer relative Markdown links, e.g. `[api/src/index.ts](api/src/index.ts)`.
- Keep it scannable: headings, tables and short bullets; no walls of text.
