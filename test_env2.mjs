import express from 'express';
import { envRoutes } from './dist/server/routes/environments.js';

const app = express();
app.use(express.json());

// Debug middleware
app.use((req, res, next) => {
  console.log('[APP] before envRoutes:', req.method, req.url);
  next();
});

app.use('/api', envRoutes);

app.use((req, res) => {
  console.log('[APP] 404 handler:', req.method, req.url);
  res.status(404).send('Not found: ' + req.url);
});

const server = app.listen(3012, async () => {
  console.log('Server on 3012');
  const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImFjY291bnQiOiIxODYxMDMxODk1MSIsImlhdCI6MTc3ODk5ODU0MiwiZXhwIjoxNzc5MDg0OTQyfQ.zf_7lGsSey9kzZmzjQwJJ23-fAawqwx3gir6s7P3bAs';
  
  const res = await fetch('http://localhost:3012/api/environments/1', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  console.log('Status:', res.status);
  const body = await res.text();
  console.log('Body:', body.substring(0, 200));
  
  server.close();
});
