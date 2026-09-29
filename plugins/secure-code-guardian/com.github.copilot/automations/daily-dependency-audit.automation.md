---
version: 1
id: daily-dependency-audit
name: Daily dependency & secret audit
description: Every morning, check dependencies against OSV.dev and scan for leaked secrets.
schedule:
  kind: cron
  expression: "0 9 * * *"
  timeZone: local
---
Run the daily security audit for this repository. Stay read-only.

1. Call the guardian `check_dependencies` tool with the absolute path of the workspace.
2. Call the guardian `scan_secrets` tool with the same path. Never print secret values.
3. Report only what changed or needs action: a table of packages with critical/high advisories and the smallest safe upgrade, plus any secret findings (file and line only).
4. If nothing needs attention, reply with a single line: "✅ No new security findings."
