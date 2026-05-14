import { spawn } from 'child_process';
import http from 'http';

const PORT = process.env.PORT || 3000;

// Start tsx watch as child process
const server = spawn('npx', ['tsx', 'watch', '--ignore', 'vite.config.ts.timestamp-*', 'src/server/index.ts'], {
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
