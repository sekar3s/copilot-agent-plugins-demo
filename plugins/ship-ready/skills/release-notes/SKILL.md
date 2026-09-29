---
name: release-notes
description: Write polished, audience-friendly release notes from git history — highlights, grouped changes, breaking-change migration guidance and contributor credits. Use when asked to draft release notes, a changelog entry, a "what's new" summary, or a GitHub Release description.
license: MIT
metadata:
  plugin: ship-ready
  version: "1.0.0"
---

# Release Notes

Turn raw commits into release notes that a product manager, a customer and an engineer would all find useful.

## Step 1 — Collect the changes

Use the first option that is available:

1. **Ship-Ready MCP server:** call `changelog_from_git` with the absolute repository path (and `version` if known).
2. **Bundled script (works everywhere, needs Node ≥ 18):**
   ```bash
   node <this-skill-folder>/scripts/collect-commits.mjs --repo . [--from v1.2.0] [--to HEAD]
   ```
   It prints JSON: `{ range, commits: [{ sha, type, scope, subject, breaking, author }], suggestedBump }`.
3. **Plain git:** `git log $(git describe --tags --abbrev=0 2>/dev/null)..HEAD --no-merges --format='%h %s'`.

## Step 2 — Understand the changes

- Group by Conventional Commit type (`feat`, `fix`, `perf`, `security`, `docs`, …). Treat non-conventional commits by reading the subject and, if unclear, the diff (`git show --stat <sha>`).
- Identify the **3 most user-visible changes** — these become *Highlights*.
- Flag anything breaking (`!` in the type, `BREAKING CHANGE` in the body, removed endpoints/flags, changed defaults).

## Step 3 — Write the notes

Follow [the template](references/template.md) exactly. Style rules:

- Lead with user value ("You can now…", "Faster…", "Fixed…"), not implementation details.
- One line per bullet; keep the short SHA at the end in parentheses.
- Merge noisy commits (typos, formatting, dependency bumps) into a single "Maintenance" bullet.
- Every breaking change needs a **Migration** step.
- Never include secrets, internal hostnames or customer names from commit messages.

## Step 4 — Deliver

- Default: return the Markdown in chat.
- If asked to save: prepend to `CHANGELOG.md` (create it if missing) or write `RELEASE_NOTES.md`.
- If asked for a GitHub Release: print the `gh release create vX.Y.Z --notes-file RELEASE_NOTES.md` command for the user to run.
