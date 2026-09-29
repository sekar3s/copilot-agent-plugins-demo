// Small, bounded file-system walker shared by the MCP tools in this plugin.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.venv', 'venv',
  '__pycache__', '.idea', '.vscode-test', 'target', 'bin', 'obj', '.turbo', '.cache', 'vendor',
]);

export const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.py', '.rb', '.go', '.java', '.kt', '.cs',
  '.php', '.rs', '.swift', '.scala', '.sh', '.bash', '.zsh', '.ps1', '.yml', '.yaml', '.toml', '.ini',
  '.cfg', '.conf', '.env', '.properties', '.xml', '.md', '.txt', '.html', '.css', '.scss', '.sql',
  '.tf', '.tfvars', '.bicep', '.dockerfile', '.gradle', '.vue', '.svelte',
]);

/** Yields { abs, rel, size } for files under root, skipping heavy/generated folders. */
export function* walk(root, { maxFiles = 5000, maxDepth = 12 } = {}) {
  let count = 0;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && depth < maxDepth) stack.push({ dir: abs, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      let size = 0;
      try {
        size = statSync(abs).size;
      } catch {
        continue;
      }
      yield { abs, rel: relative(root, abs).split('\\').join('/'), size, name: entry.name };
      if (++count >= maxFiles) return;
    }
  }
}
