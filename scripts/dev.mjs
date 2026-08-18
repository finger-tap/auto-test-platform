import { spawn } from 'child_process';
import http from 'http';
import { existsSync, readFileSync } from 'node:fs';

const PORT = process.env.PORT || 3000;

// Load .env (gitignored) into this process + the tsx child, so DB_URL etc.
// work with a plain `npm run dev`. Minimal parser: KEY=VALUE lines, # comments.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}

// Start tsx watch as child process (add --inspect to enable debugging)
const server = spawn('npx', ['tsx', 'watch', '--inspect=9229', '--ignore', 'vite.config.ts.timestamp-*', 'src/server/index.ts'], {
  stdio: 'inherit',
  env: { ...process.env },
});

// Poll until server is ready, then open browser once
let opened = false;
const timer = setInterval(() => {
  if (opened) return;
  const req = http.get(`http://localhost:${PORT}/api/health`, (res) => {
    opened = true;
    clearInterval(timer);
    import('open').then((m) => m.default(`http://localhost:${PORT}`));
  });
  req.on('error', () => {});
}, 500);

server.on('exit', (code) => {
  clearInterval(timer);
  process.exit(code || 0);
});
