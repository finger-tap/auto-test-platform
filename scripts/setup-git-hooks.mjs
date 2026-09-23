import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Point git hooks at the repo-shipped ./githooks directory so the
 * pre-commit secret guard (.env* files can never be committed, even with
 * `git add -f`) is active on every clone after a plain `npm install`.
 *
 * Idempotent. Best-effort: silently skips when git is missing or this is
 * not a git repo (e.g. an exported tarball).
 */
if (!existsSync('.git')) {
  console.log('[setup-git-hooks] not a git repo - skipping');
} else {
  try {
    execSync('git config core.hooksPath githooks', { stdio: 'ignore' });
    console.log('[setup-git-hooks] hooks -> githooks/ (pre-commit 密钥拦截已启用)');
  } catch {
    console.log('[setup-git-hooks] git not available - skipping');
  }
}
