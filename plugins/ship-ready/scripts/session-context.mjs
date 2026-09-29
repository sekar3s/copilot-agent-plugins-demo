#!/usr/bin/env node
// sessionStart: give the agent release context (branch, pending changes, commits since last tag).
import { execFileSync } from 'node:child_process';
import { readPayload, normalize, addContext, audit } from './lib/hook-io.mjs';

const PLUGIN = 'ship-ready';

const git = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).trim();
  } catch {
    return null;
  }
};

try {
  const { cwd, source } = normalize(await readPayload());
  audit(PLUGIN, { event: 'sessionStart', cwd, source });
  if (git(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true') {
    const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unknown';
    const dirty = (git(cwd, ['status', '--porcelain']) ?? '').split('\n').filter(Boolean).length;
    const tag = git(cwd, ['describe', '--tags', '--abbrev=0']);
    const since = git(cwd, ['rev-list', '--count', tag ? `${tag}..HEAD` : 'HEAD']) ?? '?';
    const upstream = git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
    const [behind, ahead] = upstream ? upstream.split(/\s+/) : [null, null];
    addContext(
      'SessionStart',
      [
        '🚢 Ship-Ready release context:',
        `- Branch: ${branch}${upstream ? ` (ahead ${ahead}, behind ${behind} of upstream)` : ''}`,
        `- Uncommitted changes: ${dirty}`,
        `- Latest tag: ${tag ?? 'none'} · commits since: ${since}`,
        'For release questions use the ship-ready MCP tools (readiness_scan, changelog_from_git, suggest_version_bump) and the release-notes skill.',
      ].join('\n'),
    );
  }
} catch (err) {
  process.stderr.write(`[${PLUGIN}] session hook error: ${err?.message ?? err}\n`);
}
process.exit(0);
