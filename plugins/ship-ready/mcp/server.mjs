#!/usr/bin/env node
// Ship-Ready MCP server: release-readiness scoring, conventional changelogs and semver advice.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, resolveTargetPath } from './lib/mcp-stdio.mjs';
import { walk } from './lib/walk.mjs';
import { git, isGitRepo, latestTag, readCommits, groupCommits, bumpFor, applyBump, TYPE_META } from './lib/git.mjs';

const VERSION = '1.0.0';

const exists = (root, ...candidates) => candidates.find((c) => existsSync(join(root, c))) ?? null;
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const SOURCE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.java', '.kt', '.cs', '.rb', '.rs', '.php', '.swift', '.vue', '.svelte']);
const TEST_FILE = /(\.|_)(test|spec)\.[a-z]+$|^test_.*\.py$|_test\.go$|Tests?\.(cs|java|kt)$/i;

/** Collect raw facts about a repository. Exported for tests. */
export function collectFacts(root) {
  const facts = { sourceFiles: 0, testFiles: 0, todo: 0, packageJsons: [], lockfiles: [] };
  for (const f of walk(root, { maxFiles: 8000 })) {
    const ext = extname(f.name).toLowerCase();
    if (f.name === 'package.json') facts.packageJsons.push(f.abs);
    if (/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|uv\.lock|Pipfile\.lock|go\.sum|Cargo\.lock)$/.test(f.name)) facts.lockfiles.push(f.rel);
    if (!SOURCE_EXT.has(ext)) continue;
    if (TEST_FILE.test(f.name) || /(^|\/)(__tests__|tests?)\//.test(f.rel)) facts.testFiles++;
    else facts.sourceFiles++;
    if (f.size < 512 * 1024) {
      try {
        const matches = readFileSync(f.abs, 'utf8').match(/\b(TODO|FIXME|HACK|XXX)\b/g);
        facts.todo += matches?.length ?? 0;
      } catch {
        /* unreadable file */
      }
    }
  }

  const scripts = {};
  for (const p of facts.packageJsons) {
    const pkg = readJson(p);
    for (const [k, v] of Object.entries(pkg?.scripts ?? {})) {
      if (k === 'test' && /no test specified/.test(v)) continue;
      scripts[k] = true;
    }
  }
  facts.scripts = scripts;

  const workflowsDir = join(root, '.github', 'workflows');
  facts.workflows = existsSync(workflowsDir) ? readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f)) : [];

  const gitignore = existsSync(join(root, '.gitignore')) ? readFileSync(join(root, '.gitignore'), 'utf8') : null;
  facts.gitignore = gitignore;

  facts.git = isGitRepo(root);
  if (facts.git) {
    const status = git(root, ['status', '--porcelain']) ?? '';
    facts.uncommitted = status ? status.split('\n').length : 0;
    facts.branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    facts.trackedEnv = (git(root, ['ls-files']) ?? '')
      .split('\n')
      .filter((f) => /(^|\/)\.env(\.[\w-]+)?$/.test(f) && !/\.(example|sample|template)$/.test(f));
    facts.tag = latestTag(root);
  }
  return facts;
}

/** Turn facts into scored checks. Exported for tests. */
export function scoreChecks(root, facts) {
  const readme = exists(root, 'README.md', 'README', 'readme.md', 'README.rst');
  const readmeSize = readme ? readFileSync(join(root, readme), 'utf8').length : 0;
  const hasPkg = facts.packageJsons.length > 0;
  const testRatio = facts.sourceFiles ? facts.testFiles / facts.sourceFiles : 0;

  const checks = [
    { area: 'Docs', name: 'README with real content', weight: 10, pass: readmeSize > 500, detail: readme ? `${readme} (${readmeSize} chars)` : 'missing', fix: 'Add a README with purpose, setup, run and test instructions.' },
    { area: 'Docs', name: 'LICENSE', weight: 5, pass: !!exists(root, 'LICENSE', 'LICENSE.md', 'LICENSE.txt'), fix: 'Add a LICENSE file (for example MIT).' },
    { area: 'Docs', name: 'CHANGELOG', weight: 5, pass: !!exists(root, 'CHANGELOG.md', 'CHANGELOG', 'HISTORY.md'), fix: 'Create CHANGELOG.md — the changelog_from_git tool can draft it.' },
    { area: 'Docs', name: 'CONTRIBUTING guide', weight: 3, pass: !!exists(root, 'CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'docs/CONTRIBUTING.md'), fix: 'Add CONTRIBUTING.md with branch, commit and PR conventions.' },
    { area: 'Security', name: 'SECURITY policy', weight: 5, pass: !!exists(root, 'SECURITY.md', '.github/SECURITY.md'), fix: 'Add SECURITY.md describing how to report vulnerabilities.' },
    { area: 'Security', name: 'No .env files tracked in git', weight: 7, pass: facts.git ? facts.trackedEnv.length === 0 : true, detail: facts.trackedEnv?.length ? facts.trackedEnv.join(', ') : undefined, fix: 'git rm --cached the .env file(s), rotate the secrets and add .env to .gitignore.' },
    { area: 'Security', name: '.gitignore covers .env and dependencies', weight: 3, pass: !!facts.gitignore && /\.env/.test(facts.gitignore) && (!hasPkg || /node_modules/.test(facts.gitignore)), fix: 'Add .env and node_modules/ to .gitignore.' },
    { area: 'Security', name: 'Automated dependency updates', weight: 5, pass: !!exists(root, '.github/dependabot.yml', '.github/dependabot.yaml', 'renovate.json', '.github/renovate.json'), fix: 'Enable Dependabot (.github/dependabot.yml) or Renovate.' },
    { area: 'Quality', name: 'Tests present', weight: 12, pass: facts.testFiles > 0, detail: `${facts.testFiles} test files / ${facts.sourceFiles} source files`, fix: 'Add unit tests for the critical paths.' },
    { area: 'Quality', name: 'Healthy test ratio (≥ 0.2)', weight: 5, pass: testRatio >= 0.2, detail: `ratio ${testRatio.toFixed(2)}`, fix: 'Increase test coverage on untested modules.' },
    { area: 'Quality', name: 'build / test / lint scripts', weight: 8, pass: !hasPkg || ['build', 'test', 'lint'].filter((s) => facts.scripts[s]).length >= 2, detail: hasPkg ? Object.keys(facts.scripts).filter((s) => ['build', 'test', 'lint'].includes(s)).join(', ') || 'none' : 'n/a', fix: 'Add npm scripts for build, test and lint.' },
    { area: 'Quality', name: 'TODO/FIXME debt under control (≤ 10)', weight: 5, pass: facts.todo <= 10, detail: `${facts.todo} markers`, fix: 'Resolve or ticket the outstanding TODO/FIXME markers.' },
    { area: 'Delivery', name: 'CI workflow', weight: 10, pass: facts.workflows.length > 0 || !!exists(root, 'azure-pipelines.yml', '.gitlab-ci.yml', 'Jenkinsfile'), detail: facts.workflows.join(', ') || undefined, fix: 'Add a GitHub Actions workflow that builds and tests on every PR.' },
    { area: 'Delivery', name: 'Lockfile committed', weight: 5, pass: !hasPkg || facts.lockfiles.length > 0, detail: facts.lockfiles.slice(0, 3).join(', ') || undefined, fix: 'Commit your package manager lockfile for reproducible builds.' },
    { area: 'Delivery', name: 'Clean working tree', weight: 7, pass: facts.git ? facts.uncommitted === 0 : false, detail: facts.git ? `${facts.uncommitted} uncommitted change(s) on ${facts.branch}` : 'not a git repository', fix: 'Commit or stash local changes before cutting a release.' },
    { area: 'Delivery', name: 'CODEOWNERS', weight: 3, pass: !!exists(root, 'CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'), fix: 'Add .github/CODEOWNERS so reviews are routed automatically.' },
  ];
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.reduce((s, c) => s + (c.pass ? c.weight : 0), 0);
  const score = Math.round((earned / total) * 100);
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  return { checks, score, grade };
}

function readinessScan({ path }) {
  const root = resolveTargetPath(path);
  if (!existsSync(root)) throw new Error(`Path not found: ${root}`);
  const facts = collectFacts(root);
  const { checks, score, grade } = scoreChecks(root, facts);
  const emoji = { A: '🟢', B: '🟢', C: '🟡', D: '🟠', F: '🔴' }[grade];
  const bar = '█'.repeat(Math.round(score / 5)).padEnd(20, '░');

  const out = [
    `# 🚢 Release readiness — ${root}`,
    '',
    `**Score: ${score}/100 · Grade ${grade} ${emoji}**  \`${bar}\``,
    '',
    '| Area | Check | Result | Details |',
    '|---|---|---|---|',
    ...checks.map((c) => `| ${c.area} | ${c.name} | ${c.pass ? '✅' : '❌'} | ${c.detail ?? ''} |`),
  ];
  const failing = checks.filter((c) => !c.pass).sort((a, b) => b.weight - a.weight);
  if (failing.length) {
    out.push('', '## Highest-impact fixes', '');
    failing.slice(0, 5).forEach((c, i) => out.push(`${i + 1}. **${c.name}** (+${c.weight} pts) — ${c.fix}`));
  } else {
    out.push('', '🎉 Everything checks out — ship it!');
  }
  return out.join('\n');
}

function changelogFromGit({ path, from, to = 'HEAD', version }) {
  const root = resolveTargetPath(path);
  if (!isGitRepo(root)) throw new Error(`${root} is not a git repository.`);
  const since = from ?? latestTag(root);
  const commits = readCommits(root, { from: since, to });
  if (!commits.length) return `No commits found ${since ? `since ${since}` : ''}.`;

  const title = version ?? 'Unreleased';
  const date = new Date().toISOString().slice(0, 10);
  const out = [`## ${title} — ${date}`, '', `_${commits.length} commits ${since ? `since \`${since}\`` : 'in history'}_`, ''];
  const breaking = commits.filter((c) => c.breaking);
  if (breaking.length) {
    out.push('### 💥 Breaking changes', '');
    breaking.forEach((c) => out.push(`- ${c.scope ? `**${c.scope}:** ` : ''}${c.subject} (${c.sha})`));
    out.push('');
  }
  for (const [type, list] of groupCommits(commits)) {
    out.push(`### ${TYPE_META[type].title}`, '');
    list.forEach((c) => out.push(`- ${c.scope ? `**${c.scope}:** ` : ''}${c.subject} (${c.sha})`));
    out.push('');
  }
  const authors = [...new Set(commits.map((c) => c.author).filter(Boolean))];
  out.push(`### 🙌 Contributors`, '', authors.map((a) => `@${a.replace(/\s+/g, '')}`).join(', '));
  const conventional = commits.filter((c) => c.type !== 'other').length;
  out.push('', `> Conventional-commit coverage: ${Math.round((conventional / commits.length) * 100)}%`);
  return out.join('\n');
}

function suggestVersionBump({ path, current }) {
  const root = resolveTargetPath(path);
  if (!isGitRepo(root)) throw new Error(`${root} is not a git repository.`);
  const tag = latestTag(root);
  const pkgVersion = readJson(join(root, 'package.json'))?.version;
  const base = current ?? tag ?? pkgVersion ?? '0.0.0';
  const commits = readCommits(root, { from: tag });
  const bump = bumpFor(commits);
  const next = bump === 'none' ? base.replace(/^v/, '') : applyBump(base, bump);
  const count = (t) => commits.filter((c) => c.type === t).length;
  return [
    `# 🔢 Version recommendation`,
    '',
    `- Current version: **${base}** (source: ${current ? 'argument' : tag ? `git tag ${tag}` : pkgVersion ? 'package.json' : 'default'})`,
    `- Commits analysed: **${commits.length}** ${tag ? `since ${tag}` : '(no tags yet — whole history)'}`,
    `- Breaking: ${commits.filter((c) => c.breaking).length} · Features: ${count('feat')} · Fixes: ${count('fix')} · Other: ${commits.length - count('feat') - count('fix')}`,
    '',
    `**Recommended bump: \`${bump}\` → \`${next}\`**`,
    '',
    'Rules (Semantic Versioning + Conventional Commits): breaking change → major, `feat` → minor, anything else → patch. Pre-1.0 projects use minor for breaking changes.',
  ].join('\n');
}

const pathProp = { path: { type: 'string', description: 'Absolute path of the repository (use the current working directory).' } };

const server = createServer({
  name: 'ship-ready',
  version: VERSION,
  instructions: 'Release-readiness tools from the Ship-Ready plugin. Always pass the absolute repository path in "path".',
  tools: [
    {
      name: 'readiness_scan',
      title: 'Release readiness scan',
      description: 'Score a repository 0-100 on release readiness (docs, security hygiene, tests, CI, lockfiles, clean tree) and list the highest-impact fixes.',
      inputSchema: { type: 'object', properties: pathProp, required: ['path'] },
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: readinessScan,
    },
    {
      name: 'changelog_from_git',
      title: 'Changelog from git history',
      description: 'Build a grouped Markdown changelog from Conventional Commits since the latest tag (or a given ref), including breaking changes and contributors.',
      inputSchema: {
        type: 'object',
        properties: {
          ...pathProp,
          from: { type: 'string', description: 'Start ref (exclusive). Defaults to the latest tag, or full history if there are no tags.' },
          to: { type: 'string', description: 'End ref (inclusive). Defaults to HEAD.' },
          version: { type: 'string', description: 'Version label for the heading, e.g. 1.4.0.' },
        },
        required: ['path'],
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: changelogFromGit,
    },
    {
      name: 'suggest_version_bump',
      title: 'Suggest semantic version bump',
      description: 'Recommend the next semantic version (major/minor/patch) from commits since the latest tag.',
      inputSchema: {
        type: 'object',
        properties: { ...pathProp, current: { type: 'string', description: 'Current version override, e.g. 1.3.2.' } },
        required: ['path'],
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: suggestVersionBump,
    },
  ],
});

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) server.start();
