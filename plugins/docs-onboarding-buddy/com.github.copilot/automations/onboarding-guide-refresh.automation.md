---
version: 1
id: onboarding-guide-refresh
name: Weekly onboarding guide refresh
description: Every Monday, check whether ONBOARDING.md still matches the codebase and propose updates.
schedule:
  kind: cron
  expression: "0 10 * * 1"
  timeZone: local
---
Keep the onboarding guide in sync with the code.

1. Use the `codebase-tour` skill to map the repository.
2. Compare the result with `ONBOARDING.md` (if it exists): commands, folders, entry points and file links that no longer exist or have changed.
3. Report the differences as a short checklist. Only rewrite `ONBOARDING.md` if the user approves.
4. If there is no `ONBOARDING.md`, generate one following the skill and show it in chat.
