---
version: 1
id: weekly-release-readiness
name: Weekly release readiness check
description: Every Friday afternoon, score the repository's release readiness and draft notes for the week's changes.
schedule:
  kind: cron
  expression: "0 16 * * 5"
  timeZone: local
---
Run a weekly release-readiness check for this repository.

1. Call the ship-ready `readiness_scan` tool with the absolute path of the workspace and report the score, grade and the top 3 fixes.
2. Call `suggest_version_bump` and state the recommended next version.
3. Use the `release-notes` skill to draft notes for the changes since the latest tag. Return them in chat and do not write files.
4. Finish with a 🟢/🟡/🔴 go/no-go verdict in one line.
