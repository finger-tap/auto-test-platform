import express from 'express';
import { envRoutes } from './dist/server/routes/environments.js';

const app = express();
app.use(express.json());
app.use('/api', envRoutes);

const server = app.listen(3011, async () => {
  console.log('Server on 3011');
  const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImFjY291bnQiOiIxODYxMDMxODk1MSIsImlhdCI6MTc3ODk5ODU0MiwiZXhwIjoxNzc5MDg0OTQyfQ.zf_7lGsSey9kzZmzjQwJJ23-fAawqwx3gir6s7P3bAs';
  
  const res = await fetch('http://localhost:3011/api/environments/1', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  console.log('Status:', res.status);
  const body = await res.text();
  console.log('Body:', body.substring(0, 300));
  
  server.close();
});
