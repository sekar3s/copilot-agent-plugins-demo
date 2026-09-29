#!/usr/bin/env node
// Collect commits since the latest tag and classify them by Conventional Commit type.
// Usage: node collect-commits.mjs [--repo <path>] [--from <ref>] [--to <ref>] [--max <n>]
// Self-contained on purpose: skills can be installed on their own, without the rest of the plugin.
import { execFileSync } from 'node:child_process';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith('--') ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), []),
);
const repo = args.repo ?? process.cwd();
const git = (a) => {
  try {
    return execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') {
  console.error(`Not a git repository: ${repo}`);
  process.exit(1);
}

const from = args.from ?? git(['describe', '--tags', '--abbrev=0']);
const to = args.to ?? 'HEAD';
for (const ref of [from, to]) {
  // Refuse anything git could parse as an option (e.g. --output=<file>).
  if (ref && (ref.startsWith('-') || !/^[\w./~^@{}+-]+$/.test(ref))) {
    console.error(`Invalid git ref: ${ref}`);
    process.exit(1);
  }
}
const range = from ? `${from}..${to}` : to;
const raw = git(['log', `--max-count=${Number(args.max) || 300}`, '--no-merges', '--format=%h%x1f%s%x1f%b%x1f%an%x1e', '--end-of-options', range]) ?? '';

const CONVENTIONAL = /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<subject>.+)$/;
const commits = raw
  .split('\x1e')
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => {
    const [sha, subject = '', body = '', author = ''] = r.split('\x1f');
    const m = CONVENTIONAL.exec(subject.trim());
    return {
      sha,
      type: m ? m.groups.type.toLowerCase() : 'other',
      scope: m?.groups.scope ?? null,
      subject: m ? m.groups.subject : subject.trim(),
      breaking: Boolean(m?.groups.bang) || /BREAKING[ -]CHANGE/.test(body),
      author,
    };
  });

const suggestedBump = commits.some((c) => c.breaking) ? 'major' : commits.some((c) => c.type === 'feat') ? 'minor' : commits.length ? 'patch' : 'none';

process.stdout.write(`${JSON.stringify({ range: from ? `${from}..${to}` : `(all history)..${to}`, count: commits.length, suggestedBump, commits }, null, 2)}\n`);
