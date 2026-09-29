#!/usr/bin/env node
// sessionStart: give the agent a compact map of the repository so onboarding answers start grounded.
import { readPayload, normalize, addContext, audit } from './lib/hook-io.mjs';
import { buildRepoMap, toMarkdown } from '../skills/codebase-tour/scripts/repo-map.mjs';

const PLUGIN = 'docs-onboarding-buddy';

try {
  const { cwd, source } = normalize(await readPayload());
  audit(PLUGIN, { event: 'sessionStart', cwd, source });
  // Without a known workspace there is nothing meaningful to map (never scan / or the home folder).
  const map = cwd ? buildRepoMap(cwd) : null;
  if (map?.totalFiles > 0) {
    addContext(
      'SessionStart',
      [
        '📚 Docs & Onboarding Buddy — repository map (auto-generated at session start):',
        '',
        toMarkdown(map, { compact: true }),
        '',
        'Use this map to ground explanations. For Microsoft/Azure/.NET/TypeScript platform docs, use the microsoft-learn MCP tools. For a full guided tour, use the codebase-tour skill.',
      ].join('\n'),
    );
  }
} catch (err) {
  process.stderr.write(`[${PLUGIN}] session hook error: ${err?.message ?? err}\n`);
}
process.exit(0);
