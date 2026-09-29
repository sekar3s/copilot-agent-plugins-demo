// Git helpers shared by the Ship-Ready MCP tools.
import { execFileSync } from 'node:child_process';

export function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}

export const isGitRepo = (cwd) => git(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true';
export const latestTag = (cwd) => git(cwd, ['describe', '--tags', '--abbrev=0']) || null;

const CONVENTIONAL = /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<subject>.+)$/;

export const TYPE_META = {
  feat: { title: '✨ Features', order: 1 },
  fix: { title: '🐛 Bug fixes', order: 2 },
  perf: { title: '⚡ Performance', order: 3 },
  security: { title: '🔒 Security', order: 4 },
  refactor: { title: '♻️ Refactoring', order: 5 },
  docs: { title: '📝 Documentation', order: 6 },
  test: { title: '✅ Tests', order: 7 },
  build: { title: '📦 Build & dependencies', order: 8 },
  ci: { title: '🤖 CI', order: 9 },
  chore: { title: '🧹 Chores', order: 10 },
  style: { title: '🎨 Style', order: 11 },
  revert: { title: '⏪ Reverts', order: 12 },
  other: { title: '📌 Other changes', order: 99 },
};

/** Parse commits in `from..to` (or the whole history when `from` is null). */
/** Reject values that git would parse as options (e.g. `--output=<file>`) instead of revisions. */
export function assertRef(ref, label) {
  if (ref == null) return;
  if (typeof ref !== 'string' || !/^[\w./~^@{}+-]+$/.test(ref) || ref.startsWith('-')) {
    throw new Error(`Invalid git ref for "${label}": ${JSON.stringify(ref)}`);
  }
}

export function readCommits(cwd, { from = null, to = 'HEAD', max = 300 } = {}) {
  assertRef(from, 'from');
  assertRef(to, 'to');
  const range = from ? `${from}..${to}` : to;
  const raw = git(cwd, ['log', `--max-count=${Number(max) || 300}`, '--no-merges', '--format=%H%x1f%s%x1f%b%x1f%an%x1e', '--end-of-options', range]);
  if (!raw) return [];
  return raw
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject = '', body = '', author = ''] = record.split('\x1f');
      const m = CONVENTIONAL.exec(subject.trim());
      const type = m ? m.groups.type.toLowerCase() : 'other';
      const breaking = Boolean(m?.groups.bang) || /BREAKING[ -]CHANGE/.test(body);
      return {
        sha: sha.slice(0, 7),
        type: TYPE_META[type] ? type : 'other',
        scope: m?.groups.scope ?? null,
        subject: m ? m.groups.subject : subject.trim(),
        breaking,
        author,
      };
    });
}

export function groupCommits(commits) {
  const groups = new Map();
  for (const c of commits) {
    if (!groups.has(c.type)) groups.set(c.type, []);
    groups.get(c.type).push(c);
  }
  return [...groups.entries()].sort((a, b) => TYPE_META[a[0]].order - TYPE_META[b[0]].order);
}

export function bumpFor(commits) {
  if (commits.some((c) => c.breaking)) return 'major';
  if (commits.some((c) => c.type === 'feat')) return 'minor';
  if (commits.length) return 'patch';
  return 'none';
}

export function applyBump(version, bump) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
  if (!m) return null;
  let [major, minor, patch] = m.slice(1).map(Number);
  // Pre-1.0 projects conventionally treat breaking changes as minor bumps.
  if (bump === 'major' && major === 0) bump = 'minor';
  if (bump === 'major') [major, minor, patch] = [major + 1, 0, 0];
  else if (bump === 'minor') [minor, patch] = [minor + 1, 0];
  else if (bump === 'patch') patch += 1;
  return `${major}.${minor}.${patch}`;
}
