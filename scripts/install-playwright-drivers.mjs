// Install Playwright browser drivers into ./drivers/ so the platform ships
// its own copies and doesn't depend on the developer's ~/.cache/ms-playwright
// or a system install. Called by the postinstall hook in package.json, or
// manually via `npm run setup:drivers`.
//
// Resumable: re-running is a no-op when the drivers are already up to date.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const driversDir = path.join(projectRoot, 'drivers');

mkdirSync(driversDir, { recursive: true });

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: driversDir };

// Same three engines the executor exposes in the env config tab. Adding a
// new browser? Add it here too.
const browsers = ['chromium', 'firefox', 'webkit'];

console.log(`[playwright-drivers] target: ${driversDir}`);
console.log(`[playwright-drivers] installing: ${browsers.join(', ')}`);

try {
  execSync(`npx playwright install ${browsers.join(' ')}`, {
    stdio: 'inherit',
    env,
    cwd: projectRoot,
  });
} catch (err) {
  console.error('[playwright-drivers] install failed');
  process.exit(err.status ?? 1);
}

const installed = existsSync(driversDir)
  ? readdirSync(driversDir).filter((n) => n.startsWith('chromium-') || n.startsWith('firefox-') || n.startsWith('webkit-'))
  : [];
console.log(`[playwright-drivers] ok — ${installed.length} engine(s) present in ${driversDir}`);
