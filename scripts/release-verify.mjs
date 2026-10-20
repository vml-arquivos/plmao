import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const requiredFiles = ['package.json', 'package-lock.json', 'Dockerfile', '.env.example', 'apps/api/src/config.ts', 'apps/api/src/migrations.ts'];
const missing = requiredFiles.filter((file) => !existsSync(join(root, file)));
if (missing.length > 0) throw new Error(`RELEASE_FILES_MISSING:${missing.join(',')}`);

const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
for (const marker of ['npm ci', 'USER node', 'HEALTHCHECK']) {
  if (!dockerfile.includes(marker)) throw new Error(`RELEASE_DOCKER_REQUIREMENT_MISSING:${marker}`);
}

if (existsSync(join(root, '.git'))) {
  const diffCheck = spawnSync('git', ['diff', '--check'], { cwd: root, encoding: 'utf8' });
  if (diffCheck.status !== 0) throw new Error(`RELEASE_DIFF_CHECK_FAILED:${diffCheck.stderr || diffCheck.stdout}`);
  const trackedEnv = spawnSync('git', ['ls-files', '.env', '.env.local'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  if (trackedEnv) throw new Error(`RELEASE_SECRET_FILE_TRACKED:${trackedEnv}`);
  console.info(JSON.stringify({ source: 'git', diffCheck: 'passed' }));
} else {
  console.info(JSON.stringify({ source: 'artifact', diffCheck: 'skipped_without_git' }));
}

const forbiddenFiles = [];
function walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (['.git', 'node_modules', 'dist', 'coverage'].includes(entry)) continue;
    const file = join(directory, entry);
    const info = statSync(file);
    if (info.isDirectory()) walk(file);
    else if (/\.(ts|tsx|js|mjs|json|md|yml|yaml|sh|env)$/.test(entry)) {
      const text = readFileSync(file, 'utf8');
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp|github_pat|sk_live|AKIA)[A-Za-z0-9_\-]{12,}/.test(text)) forbiddenFiles.push(relative(root, file));
    }
  }
}
walk(root);
if (forbiddenFiles.length > 0) throw new Error(`RELEASE_SECRET_PATTERN_FOUND:${forbiddenFiles.join(',')}`);
console.info(JSON.stringify({ ok: true, requiredFiles: requiredFiles.length, secretScan: 'passed' }));
