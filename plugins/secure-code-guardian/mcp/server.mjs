#!/usr/bin/env node
// Secure Code Guardian MCP server: secret scanning + live dependency vulnerability lookups.
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, resolveTargetPath } from './lib/mcp-stdio.mjs';
import { walk, TEXT_EXTENSIONS } from './lib/walk.mjs';

const VERSION = '1.1.0';

// ---------------------------------------------------------------------------------------------
// scan_secrets
// ---------------------------------------------------------------------------------------------
export const SECRET_RULES = [
  { id: 'aws-access-key', severity: 'critical', title: 'AWS access key ID', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', severity: 'critical', title: 'GitHub token', re: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/ },
  { id: 'private-key', severity: 'critical', title: 'Private key block', re: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'slack-token', severity: 'high', title: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'stripe-live-key', severity: 'critical', title: 'Stripe live secret key', re: /\b(sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
  { id: 'google-api-key', severity: 'high', title: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'azure-storage-key', severity: 'critical', title: 'Azure storage connection string', re: /AccountKey=[A-Za-z0-9+/=]{40,}/ },
  { id: 'openai-key', severity: 'high', title: 'OpenAI-style API key', re: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { id: 'jwt', severity: 'medium', title: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    id: 'hardcoded-credential',
    severity: 'medium',
    title: 'Hard-coded credential assignment',
    re: /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i,
    valueGroup: 2,
  },
];

const PLACEHOLDER = /(example|sample|changeme|change-me|placeholder|dummy|your[_-]|<.*>|\$\{|xxxx|redacted|test|fake|\*\*\*)/i;

const mask = (s) => (s.length <= 8 ? '****' : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)`);

export function scanText(text, rel) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.length > 2000) return;
    for (const rule of SECRET_RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const value = m[rule.valueGroup ?? 0];
      if (rule.id === 'hardcoded-credential' && PLACEHOLDER.test(value)) continue;
      if (/guardian:ignore/.test(line)) continue;
      findings.push({ file: rel, line: i + 1, rule: rule.id, title: rule.title, severity: rule.severity, preview: mask(value) });
    }
  });
  return findings;
}

function scanSecrets({ path, maxFiles = 3000 }) {
  const root = resolveTargetPath(path);
  if (!existsSync(root)) throw new Error(`Path not found: ${root}`);
  const findings = [];
  let scanned = 0;
  for (const f of walk(root, { maxFiles })) {
    const ext = extname(f.name).toLowerCase();
    const isDotEnv = f.name.startsWith('.env');
    if (!isDotEnv && !TEXT_EXTENSIONS.has(ext) && f.name !== 'Dockerfile') continue;
    if (f.size > 1024 * 1024) continue;
    if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(f.rel)) continue;
    let text;
    try {
      text = readFileSync(f.abs, 'utf8');
    } catch {
      continue;
    }
    scanned++;
    findings.push(...scanText(text, f.rel));
    if (isDotEnv && !/\.example$|\.sample$|\.template$/.test(f.name)) {
      findings.push({ file: f.rel, line: 1, rule: 'dotenv-file', title: 'Environment file present in working tree (make sure it is git-ignored)', severity: 'low', preview: '-' });
    }
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file));
  const counts = findings.reduce((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }), {});

  const out = [
    `# 🔐 Secret scan — ${root}`,
    '',
    `Scanned **${scanned}** text files. Findings: 🔴 critical ${counts.critical ?? 0} · 🟠 high ${counts.high ?? 0} · 🟡 medium ${counts.medium ?? 0} · ⚪ low ${counts.low ?? 0}`,
    '',
  ];
  if (!findings.length) {
    out.push('✅ No secrets detected.');
  } else {
    out.push('| Severity | File | Line | Rule | Preview (masked) |', '|---|---|---|---|---|');
    for (const f of findings.slice(0, 100)) {
      out.push(`| ${f.severity} | \`${f.file}\` | ${f.line} | ${f.title} | \`${f.preview}\` |`);
    }
    if (findings.length > 100) out.push('', `…and ${findings.length - 100} more.`);
    out.push('', 'Remediation: rotate any real credential, move it to a secret store / environment variable, and add the file to `.gitignore`. Add `guardian:ignore` on a line to suppress a known false positive.');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------
// check_dependencies (OSV.dev)
// ---------------------------------------------------------------------------------------------
function findManifests(root) {
  const manifests = [];
  for (const f of walk(root, { maxFiles: 20000, maxDepth: 4 })) {
    if (f.name === 'package.json' || f.name === 'requirements.txt') manifests.push(f);
  }
  return manifests;
}

function findLockfile(startDir, root) {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, 'package-lock.json');
    if (existsSync(candidate)) {
      try {
        return { dir, lock: JSON.parse(readFileSync(candidate, 'utf8')) };
      } catch {
        return null;
      }
    }
    if (dir === root || dirname(dir) === dir) return null;
    dir = dirname(dir);
  }
}

export function collectDependencies(root) {
  const deps = new Map();
  for (const m of findManifests(root)) {
    if (m.name === 'package.json') {
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(m.abs, 'utf8'));
      } catch {
        continue;
      }
      const manifestDir = dirname(m.abs);
      const lockInfo = findLockfile(manifestDir, root);
      const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const [name, spec] of Object.entries(all)) {
        let version;
        let source = 'lockfile';
        if (lockInfo?.lock?.packages) {
          const rel = relative(lockInfo.dir, manifestDir).split('\\').join('/');
          const keys = [rel ? `${rel}/node_modules/${name}` : null, `node_modules/${name}`].filter(Boolean);
          for (const k of keys) {
            if (lockInfo.lock.packages[k]?.version) {
              version = lockInfo.lock.packages[k].version;
              break;
            }
          }
        }
        if (!version) {
          const m2 = /^[\^~>=v\s]*(\d+\.\d+\.\d+[\w.-]*)/.exec(String(spec));
          if (!m2) continue;
          version = m2[1];
          source = 'range';
        }
        deps.set(`npm:${name}@${version}`, { ecosystem: 'npm', name, version, source, manifest: m.rel });
      }
    } else {
      const lines = readFileSync(m.abs, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const mm = /^\s*([A-Za-z0-9_.-]+)\s*==\s*([A-Za-z0-9_.-]+)/.exec(line);
        if (mm) deps.set(`PyPI:${mm[1]}@${mm[2]}`, { ecosystem: 'PyPI', name: mm[1], version: mm[2], source: 'pinned', manifest: m.rel });
      }
    }
  }
  return [...deps.values()];
}

function severityOf(vuln) {
  const s = vuln.database_specific?.severity;
  if (s) return String(s).toLowerCase();
  const cvss = vuln.severity?.find((x) => x.type?.startsWith('CVSS'))?.score;
  return cvss ? `cvss ${cvss}` : 'unknown';
}

const SEVERITY_RANK = { critical: 0, high: 1, moderate: 2, medium: 2, low: 3 };
const rank = (s) => SEVERITY_RANK[s] ?? 4;

const parseVer = (v) => String(v).split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
const cmpVer = (a, b) => {
  const [x, y] = [parseVer(a), parseVer(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/** Smallest version that fixes every advisory on the installed major line (falls back to any newer fix). */
export function safeUpgrade(installed, fixes) {
  const newer = [...new Set(fixes)].filter((f) => cmpVer(f, installed) > 0);
  if (!newer.length) return '—';
  const major = parseVer(installed)[0];
  const sameMajor = newer.filter((f) => parseVer(f)[0] === major);
  const pool = sameMajor.length ? sameMajor : newer;
  return pool.sort(cmpVer)[sameMajor.length ? pool.length - 1 : 0];
}

function fixedVersion(vuln, name) {
  const fixes = [];
  for (const a of vuln.affected ?? []) {
    if (a.package?.name !== name) continue;
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) fixes.push(e.fixed);
  }
  return fixes.length ? fixes.join(', ') : '—';
}

async function checkDependencies({ path }) {
  const root = resolveTargetPath(path);
  const deps = collectDependencies(root);
  if (!deps.length) return `No package.json or pinned requirements.txt dependencies found under ${root}.`;

  let batch;
  try {
    const res = await fetch('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: deps.map((d) => ({ package: { name: d.name, ecosystem: d.ecosystem }, version: d.version })) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`OSV responded ${res.status}`);
    batch = await res.json();
  } catch (err) {
    return [
      `⚠️ Could not reach OSV.dev (${err.message}). Checked ${deps.length} dependencies offline only.`,
      'Re-run when online, or run `npm audit` locally as a fallback.',
    ].join('\n');
  }

  const hits = [];
  batch.results?.forEach((r, i) => (r.vulns ?? []).forEach((v) => hits.push({ dep: deps[i], id: v.id })));

  const details = await Promise.all(
    hits.slice(0, 60).map(async (h) => {
      try {
        const res = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(h.id)}`, { signal: AbortSignal.timeout(10000) });
        return { ...h, vuln: res.ok ? await res.json() : null };
      } catch {
        return { ...h, vuln: null };
      }
    }),
  );
  for (const d of details) d.severity = d.vuln ? severityOf(d.vuln) : 'unknown';
  details.sort((a, b) => rank(a.severity) - rank(b.severity) || a.dep.name.localeCompare(b.dep.name));

  // Per-package roll-up: advisory count, worst severity and the highest "fixed in" on the same major line.
  const byPkg = new Map();
  for (const h of hits) {
    const key = `${h.dep.name}@${h.dep.version}`;
    const entry = byPkg.get(key) ?? { dep: h.dep, count: 0, worst: 'unknown', fixes: [] };
    entry.count++;
    const d = details.find((x) => x.id === h.id && x.dep === h.dep);
    if (d) {
      if (rank(d.severity) < rank(entry.worst)) entry.worst = d.severity;
      entry.fixes.push(...fixedVersion(d.vuln ?? {}, h.dep.name).split(', ').filter((v) => v !== '—'));
    }
    byPkg.set(key, entry);
  }

  const out = [
    `# 🛡️ Dependency vulnerability report — ${root}`,
    '',
    `Checked **${deps.length}** dependencies against [OSV.dev](https://osv.dev). Vulnerable packages: **${byPkg.size}** · advisories: **${hits.length}**`,
    '',
  ];
  if (!hits.length) {
    out.push('✅ No known vulnerabilities found.');
    return out.join('\n');
  }

  out.push('## Summary by package', '', '| Package | Installed | Advisories | Worst severity | Upgrade to (≥) | Manifest |', '|---|---|---|---|---|---|');
  const pkgs = [...byPkg.values()].sort((a, b) => rank(a.worst) - rank(b.worst) || b.count - a.count);
  for (const p of pkgs) {
    out.push(`| **${p.dep.name}** | ${p.dep.version}${p.dep.source === 'range' ? '*' : ''} | ${p.count} | ${p.worst} | ${safeUpgrade(p.dep.version, p.fixes)} | \`${p.dep.manifest}\` |`);
  }

  const seenIds = new Set();
  const uniqueDetails = details.filter((d) => !seenIds.has(d.id) && seenIds.add(d.id));
  out.push('', '## Advisories (most severe first)', '', '| Package | Advisory | Severity | Fixed in | Summary |', '|---|---|---|---|---|');
  for (const d of uniqueDetails.slice(0, 25)) {
    const summary = (d.vuln?.summary ?? d.vuln?.details ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 110);
    out.push(`| ${d.dep.name} | [${d.id}](https://osv.dev/vulnerability/${d.id}) | ${d.severity} | ${d.vuln ? fixedVersion(d.vuln, d.dep.name) : '?'} | ${summary} |`);
  }
  if (uniqueDetails.length > 25 || hits.length > details.length) out.push('', '…more advisories omitted — see the summary table above.');
  out.push('', '`*` = version inferred from a semver range because no lockfile entry was found.');
  return out.join('\n');
}

const server = createServer({
  name: 'guardian',
  version: VERSION,
  instructions:
    'Security tools from the Secure Code Guardian plugin. Always pass the absolute path of the repository being reviewed in the "path" argument.',
  tools: [
    {
      name: 'scan_secrets',
      title: 'Scan for secrets',
      description:
        'Scan a repository for hard-coded secrets (cloud keys, tokens, private keys, credential assignments). Values are masked in the output.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path of the repository or folder to scan.' },
          maxFiles: { type: 'number', description: 'Maximum number of files to scan (default 3000).' },
        },
        required: ['path'],
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: scanSecrets,
    },
    {
      name: 'check_dependencies',
      title: 'Check dependencies for known vulnerabilities',
      description:
        'Look up npm (package.json + package-lock.json) and PyPI (pinned requirements.txt) dependencies in the OSV.dev vulnerability database and report advisories with severity and fixed versions.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute path of the repository to check.' } },
        required: ['path'],
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: checkDependencies,
    },
  ],
});

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) server.start();
