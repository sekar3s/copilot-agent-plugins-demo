#!/usr/bin/env node
// Build a quick "map" of a repository: stack, top-level folders, entry points, scripts and docs.
// Usage: node repo-map.mjs [--repo <path>] [--json]
// Self-contained (Node >= 18, no dependencies) so the skill also works when installed on its own.
import { readdirSync, readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.venv', 'venv', '__pycache__', 'target', 'bin', 'obj', '.cache', '.turbo']);
const LANG = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin', '.cs': 'C#', '.rb': 'Ruby', '.rs': 'Rust', '.php': 'PHP',
  '.swift': 'Swift', '.vue': 'Vue', '.svelte': 'Svelte', '.sql': 'SQL', '.bicep': 'Bicep', '.tf': 'Terraform', '.sh': 'Shell', '.ps1': 'PowerShell',
};
const FRAMEWORKS = {
  react: 'React', next: 'Next.js', vue: 'Vue', '@angular/core': 'Angular', svelte: 'Svelte', vite: 'Vite', tailwindcss: 'Tailwind CSS',
  express: 'Express', fastify: 'Fastify', '@nestjs/core': 'NestJS', koa: 'Koa', 'better-sqlite3': 'SQLite', sqlite3: 'SQLite', pg: 'PostgreSQL',
  mongoose: 'MongoDB', prisma: 'Prisma', typeorm: 'TypeORM', jest: 'Jest', vitest: 'Vitest', '@playwright/test': 'Playwright', cypress: 'Cypress',
  'swagger-ui-express': 'Swagger/OpenAPI', typescript: 'TypeScript', electron: 'Electron',
};
const ENTRY = /^(index|main|app|server|program|manage)\.(ts|tsx|js|mjs|py|go|cs|java)$/i;

function countFiles(dir, depth = 0, acc = { files: 0, langs: {}, entries: [] }, rel = '') {
  if (depth > 8 || acc.files > 20000) return acc;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name) && !e.name.startsWith('.')) countFiles(join(dir, e.name), depth + 1, acc, rel ? `${rel}/${e.name}` : e.name);
    } else if (e.isFile()) {
      acc.files++;
      const lang = LANG[extname(e.name).toLowerCase()];
      if (lang) acc.langs[lang] = (acc.langs[lang] ?? 0) + 1;
      if (ENTRY.test(e.name) && depth <= 3) acc.entries.push(rel ? `${rel}/${e.name}` : e.name);
    }
  }
  return acc;
}

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

export function buildRepoMap(root) {
  const top = readdirSync(root, { withFileTypes: true });
  const folders = top
    .filter((e) => e.isDirectory() && !SKIP.has(e.name) && (!e.name.startsWith('.') || e.name === '.github'))
    .map((e) => {
      const stats = countFiles(join(root, e.name));
      const langs = Object.entries(stats.langs).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([l]) => l);
      return { name: e.name, files: stats.files, langs, entries: stats.entries.map((x) => `${e.name}/${x}`) };
    })
    .sort((a, b) => b.files - a.files);

  const all = countFiles(root);
  const languages = Object.entries(all.langs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, n]) => `${l} (${n})`);

  const frameworks = new Set();
  const scripts = [];
  const pkgPaths = [join(root, 'package.json'), ...folders.map((f) => join(root, f.name, 'package.json'))];
  for (const p of pkgPaths) {
    const pkg = existsSync(p) ? readJson(p) : null;
    if (!pkg) continue;
    const where = basename(join(p, '..')) === basename(root) ? '.' : basename(join(p, '..'));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) if (FRAMEWORKS[dep]) frameworks.add(FRAMEWORKS[dep]);
    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) scripts.push({ where, name, cmd });
  }
  const marker = (f, label) => existsSync(join(root, f)) && frameworks.add(label);
  marker('requirements.txt', 'Python (pip)');
  marker('pyproject.toml', 'Python (pyproject)');
  marker('go.mod', 'Go modules');
  marker('pom.xml', 'Maven');
  marker('build.gradle', 'Gradle');
  marker('Dockerfile', 'Docker');
  marker('docker-compose.yml', 'Docker Compose');
  marker('.devcontainer', 'Dev Container');
  if (existsSync(join(root, 'infra'))) frameworks.add('Infrastructure as Code (infra/)');
  if (existsSync(join(root, '.github', 'workflows'))) frameworks.add('GitHub Actions');

  const docs = [];
  for (const f of ['README.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md', 'SECURITY.md']) if (existsSync(join(root, f))) docs.push(f);
  const docsDir = join(root, 'docs');
  if (existsSync(docsDir) && statSync(docsDir).isDirectory()) {
    for (const f of readdirSync(docsDir)) if (f.endsWith('.md')) docs.push(`docs/${f}`);
  }

  return {
    root,
    name: basename(root),
    totalFiles: all.files,
    languages,
    stack: [...frameworks],
    folders,
    entryPoints: [...all.entries].filter((e) => !/test|spec/i.test(e)).slice(0, 10),
    scripts: scripts.slice(0, 25),
    docs: docs.slice(0, 20),
  };
}

export function toMarkdown(map, { compact = false } = {}) {
  const lines = [
    `# 🗺️ Repo map — ${map.name}`,
    '',
    `- **Files:** ${map.totalFiles} · **Languages:** ${map.languages.join(', ') || 'n/a'}`,
    `- **Stack:** ${map.stack.join(', ') || 'n/a'}`,
    '',
    '| Folder | Files | Main languages |',
    '|---|---|---|',
    ...map.folders.slice(0, compact ? 8 : 20).map((f) => `| \`${f.name}/\` | ${f.files} | ${f.langs.join(', ')} |`),
  ];
  if (map.entryPoints.length) lines.push('', `**Likely entry points:** ${map.entryPoints.map((e) => `\`${e}\``).join(', ')}`);
  if (!compact && map.scripts.length) {
    lines.push('', '**Scripts:**', '', '| Where | Script | Command |', '|---|---|---|');
    map.scripts.forEach((s) => lines.push(`| ${s.where} | \`${s.name}\` | \`${s.cmd.replace(/\|/g, '\\|')}\` |`));
  }
  if (map.docs.length) lines.push('', `**Docs to read first:** ${map.docs.map((d) => `\`${d}\``).join(', ')}`);
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const repoIdx = argv.indexOf('--repo');
  const root = repoIdx >= 0 ? argv[repoIdx + 1] : process.cwd();
  const map = buildRepoMap(root);
  process.stdout.write(argv.includes('--json') ? `${JSON.stringify(map, null, 2)}\n` : `${toMarkdown(map)}\n`);
}
