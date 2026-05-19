import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authMiddleware } from '../auth/middleware.js';
import { parseSpec, parseFromUrl } from './parser.js';
import { exportToOpenAPI3, exportToPostman } from './exporter.js';
import { findApisByUserId, createApi } from '../db/apis.js';

export const openapiRoutes = Router();
openapiRoutes.use(authMiddleware);

// Configure multer for file upload (max 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.json', '.yaml', '.yml'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (allowed.includes(ext) || file.mimetype.includes('json') || file.mimetype.includes('yaml')) {
      cb(null, true);
    } else {
      cb(new Error('Only JSON and YAML files are allowed'));
    }
  },
});

/** POST /api/openapi/import-file — 导入文件 */
openapiRoutes.post('/import-file', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ code: 400, message: 'No file uploaded' });
      return;
    }
    const raw = req.file.buffer.toString('utf-8');
    const result = await parseSpec(raw);
    res.json({ code: 200, message: 'Parsed successfully', data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    res.status(400).json({ code: 400, message });
  }
});

/** POST /api/openapi/import-url — 导入在线文档URL */
openapiRoutes.post('/import-url', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ code: 400, message: 'URL is required' });
      return;
    }
    const result = await parseFromUrl(url);
    res.json({ code: 200, message: 'Parsed successfully', data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    res.status(400).json({ code: 400, message });
  }
});

/** POST /api/openapi/import-confirm — 确认导入，保存到数据库 */
openapiRoutes.post('/import-confirm', async (req: Request, res: Response) => {
  try {
    const { apis } = req.body;
    if (!Array.isArray(apis) || apis.length === 0) {
      res.status(400).json({ code: 400, message: 'No APIs to import' });
      return;
    }

    const imported: number[] = [];
    for (const api of apis) {
      const id = createApi(req.user!.userId, {
        name: api.name || 'Untitled API',
        method: (api.method || 'GET').toUpperCase(),
        url: api.url || '/',
        description: api.description || '',
        tags: (api.tags || []).join(','),
        status: 'active',
        content_type: api.content_type || '',
        body: api.body || null,
        headers: api.headers ? JSON.stringify(Object.entries(api.headers).map(([k, v]) => ({ key: k, value: v }))) : null,
      });
      imported.push(id);
    }

    res.status(201).json({ code: 201, message: `Imported ${imported.length} APIs`, data: { count: imported.length, ids: imported } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    res.status(500).json({ code: 500, message });
  }
});

/** GET /api/openapi/export — 导出 OpenAPI 3.0 文件 */
openapiRoutes.get('/export', (req: Request, res: Response) => {
  try {
    const idsParam = req.query.ids as string;
    const format = (req.query.format as string) || 'openapi';
    const title = (req.query.title as string) || 'API Export';
    const version = (req.query.version as string) || '1.0.0';
    const baseUrl = (req.query.baseUrl as string) || '';

    const allApis = findApisByUserId(req.user!.userId);
    let apis = allApis;

    if (idsParam) {
      const ids = idsParam.split(',').map(Number).filter(Boolean);
      apis = allApis.filter(a => ids.includes(a.id));
    }

    if (format === 'postman') {
      const doc = exportToPostman(apis, { title, version });
      res.setHeader('Content-Disposition', `attachment; filename="${title}.postman_collection.json"`);
      res.setHeader('Content-Type', 'application/json');
      res.json(doc);
    } else {
      const doc = exportToOpenAPI3(apis, { title, version, baseUrl });
      res.setHeader('Content-Disposition', `attachment; filename="${title}.openapi.json"`);
      res.setHeader('Content-Type', 'application/json');
      res.json(doc);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed';
    res.status(500).json({ code: 500, message });
  }
});