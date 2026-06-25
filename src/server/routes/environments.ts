import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findEnvsByUserId,
  findEnvById,
  findEnvByName,
  findDefaultEnv,
  createEnv,
  updateEnv,
  deleteEnv,
} from '../db/environments.js';

export const envRoutes = Router();
envRoutes.use(authMiddleware);

// GET /api/environments
envRoutes.get('/', (req: Request, res: Response) => {
  const envs = findEnvsByUserId(req.user!.userId);
  res.json({ code: 200, message: 'ok', data: envs });
});

// GET /api/environments/default — must be before /:id to avoid Express matching "default" as :id
envRoutes.get('/default', (req: Request, res: Response) => {
  const env = findDefaultEnv(req.user!.userId);
  res.json({ code: 200, message: 'ok', data: env });
});

// GET /api/environments/:id
envRoutes.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const env = findEnvById(id, req.user!.userId);
  if (!env) {
    res.status(404).json({ code: 404, message: '环境不存在' });
    return;
  }
  res.json({ code: 200, message: 'ok', data: env });
});

// POST /api/environments
envRoutes.post('/', (req: Request, res: Response) => {
  const { name, variables, ssl_cert, ssl_key, ssl_certs, timeout, is_default, databases } = req.body as {
    name?: string;
    variables?: Array<{ key: string; value: string; description?: string; enabled?: boolean }>;
    ssl_cert?: string;
    ssl_key?: string;
    ssl_certs?: Array<{ name: string; cert: string; key: string }>;
    timeout?: number;
    is_default?: boolean;
    databases?: Array<{ name: string; type: string; host: string; port: number; user: string; password: string; database: string }>;
  };

  if (!name?.trim()) {
    res.status(400).json({ code: 400, message: '环境名称不能为空' });
    return;
  }

  const trimmedName = name.trim();
  if (findEnvByName(req.user!.userId, trimmedName)) {
    res.status(409).json({ code: 409, message: '已存在同名环境' });
    return;
  }

  const id = createEnv(req.user!.userId, trimmedName, variables || [], {
    ssl_cert, ssl_key, ssl_certs, timeout, is_default, databases,
  });
  const env = findEnvById(id, req.user!.userId);
  res.json({ code: 200, message: '创建成功', data: env });
});

// PUT /api/environments/:id
envRoutes.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const env = findEnvById(id, req.user!.userId);
  if (!env) {
    res.status(404).json({ code: 404, message: '环境不存在' });
    return;
  }

  const { name, variables, ssl_cert, ssl_key, ssl_certs, timeout, is_default, databases } = req.body as {
    name?: string;
    variables?: Array<{ key: string; value: string; description?: string; enabled?: boolean }>;
    ssl_cert?: string | null;
    ssl_key?: string | null;
    ssl_certs?: Array<{ name: string; cert: string; key: string }>;
    timeout?: number;
    is_default?: boolean;
    databases?: Array<{ name: string; type: string; host: string; port: number; user: string; password: string; database: string }>;
  };

  const checkName = name ? name.trim() : env.name;
  const existingEnv = findEnvByName(req.user!.userId, checkName);
  if (existingEnv && existingEnv.id !== env.id) {
    res.status(409).json({ code: 409, message: '已存在同名环境' });
    return;
  }

  updateEnv(id, req.user!.userId, {
    name: name?.trim(),
    variables,
    ssl_cert,
    ssl_key,
    ssl_certs,
    timeout,
    is_default,
    databases,
  });

  const updated = findEnvById(id, req.user!.userId);
  res.json({ code: 200, message: '更新成功', data: updated });
});

// DELETE /api/environments/:id
envRoutes.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const env = findEnvById(id, req.user!.userId);
  if (!env) {
    res.status(404).json({ code: 404, message: '环境不存在' });
    return;
  }

  deleteEnv(id, req.user!.userId);
  res.json({ code: 200, message: '删除成功' });
});

// POST /api/environments/test-db — test database connection
envRoutes.post('/test-db', async (req: Request, res: Response) => {
  const { type, host, port, user, password, database } = req.body;
  if (!host) {
    res.json({ code: 200, data: { success: false, message: '请填写主机地址' } });
    return;
  }
  const { testDbConnection } = await import('../db/db-pool.js');
  const cfg = {
    type: type || 'mysql',
    host,
    port: port || (type === 'mysql' ? 3306 : 5432),
    user: user || '',
    password: password || '',
    database: database || '',
  };
  const err = await testDbConnection(cfg);
  if (err) {
    res.json({ code: 200, data: { success: false, message: `连接失败: ${err}` } });
  } else {
    res.json({ code: 200, data: { success: true, message: '连接成功！' } });
  }
});