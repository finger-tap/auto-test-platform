// 2026-06-23: Mobile apps API — APK/IPA/HAP 包管理 + 安装到设备

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  findMobileAppsByUser,
  findMobileAppById,
  createMobileApp,
  updateMobileApp,
  deleteMobileApp,
  addMobileAppVersion,
  removeMobileAppVersion,
  type MobileAppVersion,
  type CreateMobileAppInput,
  type UpdateMobileAppInput,
} from '../db/mobile-apps.js';
import { authMiddleware } from '../auth/middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const APP_STORE_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'mobile-apps')
  : path.join(PROJECT_ROOT, 'data', 'mobile-apps');

const mobileAppRoutes = Router();
mobileAppRoutes.use(authMiddleware);

// ── multer for APK/IPA/HAP upload ──
const upload = multer({
  dest: path.join(PROJECT_ROOT, 'data', 'tmp-uploads'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.apk', '.ipa', '.hap'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .apk / .ipa / .hap 文件'));
    }
  },
});

// ── GET /mobile-apps ──
mobileAppRoutes.get('/', (req: Request, res: Response) => {
  const filters = {
    name: req.query.name as string | undefined,
    platform: req.query.platform as string | undefined,
    packageName: req.query.packageName as string | undefined,
    dateFrom: req.query.dateFrom as string | undefined,
    dateTo: req.query.dateTo as string | undefined,
  };
  const apps = findMobileAppsByUser(req.user!.userId, filters);
  res.json({ code: 200, message: 'ok', data: apps });
});

// ── GET /mobile-apps/:id ──
mobileAppRoutes.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const app = findMobileAppById(id, req.user!.userId);
  if (!app) {
    res.status(404).json({ code: 404, message: '应用不存在' });
    return;
  }
  res.json({ code: 200, message: 'ok', data: app });
});

// ── POST /mobile-apps ──
mobileAppRoutes.post('/', (req: Request, res: Response) => {
  const { name, platform, package_name } = req.body as CreateMobileAppInput;
  if (!name?.trim()) {
    res.status(400).json({ code: 400, message: '应用名称不能为空' });
    return;
  }
  const id = createMobileApp(req.user!.userId, {
    name: name.trim(),
    platform: platform || 'android',
    package_name,
  });
  res.json({ code: 200, message: '创建成功', data: { id } });
});

// ── PUT /mobile-apps/:id ──
mobileAppRoutes.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const data: UpdateMobileAppInput = {};
  if (req.body.name !== undefined) data.name = req.body.name;
  if (req.body.platform !== undefined) data.platform = req.body.platform;
  if (req.body.package_name !== undefined) data.package_name = req.body.package_name;

  const ok = updateMobileApp(id, req.user!.userId, data);
  if (!ok) {
    res.status(404).json({ code: 404, message: '应用不存在' });
    return;
  }
  res.json({ code: 200, message: '更新成功' });
});

// ── DELETE /mobile-apps/:id ──
mobileAppRoutes.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const app = findMobileAppById(id, req.user!.userId);
  if (!app) {
    res.status(404).json({ code: 404, message: '应用不存在' });
    return;
  }

  // Delete all version files
  const appDir = path.join(APP_STORE_DIR, String(id));
  if (fs.existsSync(appDir)) {
    fs.rmSync(appDir, { recursive: true, force: true });
  }

  deleteMobileApp(id, req.user!.userId);
  res.json({ code: 200, message: '删除成功' });
});

// ── POST /mobile-apps/:id/versions — upload a new version ──
mobileAppRoutes.post('/:id/versions', upload.single('file'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const app = findMobileAppById(id, req.user!.userId);
  if (!app) {
    cleanupTemp(req.file);
    res.status(404).json({ code: 404, message: '应用不存在' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ code: 400, message: '请上传文件' });
    return;
  }

  const version = (req.body.version as string || '').trim();
  if (!version) {
    cleanupTemp(req.file);
    res.status(400).json({ code: 400, message: '版本号不能为空' });
    return;
  }

  const changelog = (req.body.changelog as string || '').trim();

  // Move file to permanent location: data/mobile-apps/{app_id}/{version}/
  const versionDir = path.join(APP_STORE_DIR, String(id), version);
  fs.mkdirSync(versionDir, { recursive: true });

  const ext = path.extname(req.file.originalname).toLowerCase();
  const destPath = path.join(versionDir, `${app.name}-v${version}${ext}`);
  fs.renameSync(req.file.path, destPath);

  const versionInfo: MobileAppVersion = {
    version,
    filename: path.basename(destPath),
    file_size: req.file.size,
    uploaded_at: new Date().toISOString(),
    changelog: changelog || undefined,
  };

  addMobileAppVersion(id, req.user!.userId, versionInfo);
  res.json({ code: 200, message: '上传成功', data: versionInfo });
});

// ── DELETE /mobile-apps/:id/versions/:version ──
mobileAppRoutes.delete('/:id/versions/:version', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const version = req.params.version;

  const result = removeMobileAppVersion(id, req.user!.userId, version);
  if (!result.ok) {
    res.status(404).json({ code: 404, message: '版本不存在' });
    return;
  }

  // Delete version files
  const versionDir = path.join(APP_STORE_DIR, String(id), version);
  if (fs.existsSync(versionDir)) {
    fs.rmSync(versionDir, { recursive: true, force: true });
  }

  res.json({ code: 200, message: '删除成功' });
});

// ── POST /mobile-apps/:id/install — install on device ──
mobileAppRoutes.post('/:id/install', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { deviceId, version } = req.body as { deviceId?: number; version?: string };

  const app = findMobileAppById(id, req.user!.userId);
  if (!app) {
    res.status(404).json({ code: 404, message: '应用不存在' });
    return;
  }

  const targetVersion = version || app.latest_version;
  if (!targetVersion) {
    res.status(400).json({ code: 400, message: '没有可安装的版本' });
    return;
  }

  const versions: MobileAppVersion[] = JSON.parse(app.versions);
  const verInfo = versions.find(v => v.version === targetVersion);
  if (!verInfo) {
    res.status(404).json({ code: 404, message: `版本 ${targetVersion} 不存在` });
    return;
  }

  const filePath = path.join(APP_STORE_DIR, String(id), targetVersion, verInfo.filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ code: 404, message: '安装包文件不存在' });
    return;
  }

  try {
    const { installAppOnDevice } = await import('../engine/app-installer.js');
    const { getDeviceForUser } = await import('../db/devices.js');

    if (deviceId) {
      const device = getDeviceForUser(deviceId, req.user!.userId);
      if (!device) {
        res.status(404).json({ code: 404, message: '设备不存在' });
        return;
      }
      const isRemote = !!device.ssh_host;
      const result = await installAppOnDevice({
        filePath,
        platform: app.platform,
        serial: device.serial || undefined,
        device,
        isRemote,
      });
      res.json({ code: 200, message: '安装成功', data: result });
    } else {
      // Local install without specific device
      const result = await installAppOnDevice({
        filePath,
        platform: app.platform,
        isRemote: false,
      });
      res.json({ code: 200, message: '安装成功', data: result });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[routes:mobile-apps] install failed app=${id} err=${msg}`);
    res.status(500).json({ code: 500, message: `安装失败: ${msg}` });
  }
});

function cleanupTemp(file?: Express.Multer.File) {
  if (file?.path && fs.existsSync(file.path)) {
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }
  }
}

export default mobileAppRoutes;
