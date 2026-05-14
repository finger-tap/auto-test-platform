import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import './db/index.js';
import { routes } from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

app.use(cors());
app.use(express.json());

// Serve avatar files
const dataDir = path.resolve(__dirname, '../../data');
app.use('/avatars', express.static(path.join(dataDir, 'avatars')));

// API routes
app.use('/api', routes);

// Frontend serving
if (isDev) {
  // Dev: Vite middleware on same port — HMR + API together
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: path.resolve(__dirname, '../..'),
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  // Production: serve built static files
  const clientDist = path.resolve(__dirname, '../../dist/client');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  ➜  Local:   ${url}\n`);
});
