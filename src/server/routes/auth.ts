import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { findUserByAccount, findUserById, createUser, updatePassword, updateUserProfile } from '../db/users.js';
import { signToken } from '../auth/jwt.js';
import { authMiddleware } from '../auth/middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const avatarDir = path.resolve(__dirname, '../../../data/avatars');

export const authRoutes = Router();

// Per-IP rate limit for sensitive auth endpoints to prevent credential stuffing
// and account-enumeration abuse. 5 req / minute / IP is enough for legitimate use.
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: 'Too many requests, please try again later.' },
});

// Allowed image formats with their magic-byte signatures and canonical extensions.
// SVG is intentionally excluded — it can carry <script> and bypass <img> sandboxing.
const ALLOWED_IMAGE_TYPES: Array<{
  ext: string;
  mime: string;
  match: (head: Buffer) => boolean;
}> = [
  { ext: '.jpg', mime: 'image/jpeg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', mime: 'image/png', match: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  {
    ext: '.gif',
    mime: 'image/gif',
    match: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
  {
    ext: '.webp',
    mime: 'image/webp',
    // RIFF....WEBP — 12 bytes total
    match: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

function detectImageType(filePath: string): { ext: string; mime: string } | null {
  let head: Buffer;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(12);
      fs.readSync(fd, buf, 0, 12, 0);
      head = buf;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  for (const t of ALLOWED_IMAGE_TYPES) {
    if (t.match(head)) return { ext: t.ext, mime: t.mime };
  }
  return null;
}

// Multer config: no mimetype whitelist here (mimetype is client-controlled).
// We validate by reading magic bytes after upload.
const upload = multer({
  dest: avatarDir,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

/**
 * Validate uploaded file by magic bytes, rename to a UUID-based filename
 * with a canonical extension, and delete the temp multer file.
 * Returns null and sends a 400 response on failure.
 */
function acceptAvatarUpload(req: Request, res: Response): { ext: string; newPath: string } | null {
  if (!req.file) {
    res.status(400).json({ code: 400, message: 'No file uploaded' });
    return null;
  }
  const detected = detectImageType(req.file.path);
  if (!detected) {
    fs.unlink(req.file.path, () => {});
    res.status(400).json({ code: 400, message: 'Invalid image format (only JPEG, PNG, GIF, WebP allowed)' });
    return null;
  }
  const newName = `${crypto.randomUUID()}${detected.ext}`;
  const newPath = path.join(avatarDir, newName);
  try {
    fs.renameSync(req.file.path, newPath);
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ code: 500, message: 'Failed to save avatar' });
    return null;
  }
  return { ext: detected.ext, newPath };
}

function userResponse(user: { id: number; account: string; account_type: string; nickname: string | null; avatar: string | null; email: string | null; phone: string | null }) {
  return {
    userId: user.id,
    account: user.account,
    accountType: user.account_type,
    nickname: user.nickname || user.account.slice(0, 3),
    avatar: user.avatar,
    email: user.email,
    phone: user.phone,
  };
}

// POST /api/auth/register
authRoutes.post('/register', authLimiter, upload.single('avatar'), async (req: Request, res: Response) => {
  const { account, password, nickname } = req.body;

  if (!account || typeof account !== 'string' || !account.trim()) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(400).json({ code: 400, message: 'Account is required' });
    return;
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(400).json({ code: 400, message: 'Password must be at least 6 characters' });
    return;
  }

  const trimmedAccount = account.trim();

  const existing = findUserByAccount(trimmedAccount);
  if (existing) {
    // Clean up uploaded file if account exists
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(409).json({ code: 409, message: 'Account already exists' });
    return;
  }

  let avatarPath: string | undefined;
  if (req.file) {
    const accepted = acceptAvatarUpload(req, res);
    if (!accepted) return; // response already sent
    avatarPath = `/avatars/${path.basename(accepted.newPath)}`;
  }

  const hash = await bcrypt.hash(password, 10);
  const userId = createUser(trimmedAccount, hash, undefined, nickname?.trim() || undefined, avatarPath);

  res.status(201).json({ code: 201, message: 'Registration successful', data: { userId } });
});

// POST /api/auth/login
authRoutes.post('/login', authLimiter, async (req: Request, res: Response) => {
  const { account, password } = req.body;

  if (!account || !password) {
    res.status(400).json({ code: 400, message: 'Account and password are required' });
    return;
  }

  const user = findUserByAccount(account.trim());
  if (!user) {
    res.status(401).json({ code: 401, message: 'Invalid account or password' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ code: 401, message: 'Invalid account or password' });
    return;
  }

  const token = signToken({ userId: user.id, account: user.account });

  res.json({
    code: 200,
    message: 'Login successful',
    data: { token, user: userResponse(user) },
  });
});

// POST /api/auth/guest
authRoutes.post('/guest', async (_req: Request, res: Response) => {
  const GUEST_ACCOUNT = 'guest';

  let user = findUserByAccount(GUEST_ACCOUNT);
  if (!user) {
    const hash = await bcrypt.hash('guest', 10);
    createUser(GUEST_ACCOUNT, hash, 'guest');
    user = findUserByAccount(GUEST_ACCOUNT);
  }

  const token = signToken({ userId: user!.id, account: user!.account });

  res.json({
    code: 200,
    message: 'Guest login successful',
    data: { token, user: userResponse(user!) },
  });
});

// POST /api/auth/reset-password
// Security: requires authentication. The target account is derived from
// the JWT (req.user), never from the request body. Caller must supply
// the current password to confirm ownership.
authRoutes.post('/reset-password', authLimiter, authMiddleware, async (req: Request, res: Response) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || typeof oldPassword !== 'string') {
    res.status(400).json({ code: 400, message: 'Current password is required' });
    return;
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    res.status(400).json({ code: 400, message: 'New password must be at least 6 characters' });
    return;
  }
  if (oldPassword === newPassword) {
    res.status(400).json({ code: 400, message: 'New password must differ from current password' });
    return;
  }

  const user = findUserById(req.user!.userId);
  if (!user) {
    res.status(404).json({ code: 404, message: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(oldPassword, user.password_hash);
  if (!valid) {
    res.status(401).json({ code: 401, message: 'Current password is incorrect' });
    return;
  }

  const hash = await bcrypt.hash(newPassword, 10);
  updatePassword(user.account, hash);

  res.json({ code: 200, message: 'Password reset successfully' });
});

// GET /api/auth/me
authRoutes.get('/me', authMiddleware, (req: Request, res: Response) => {
  const user = findUserById(req.user!.userId);
  if (!user) {
    res.status(404).json({ code: 404, message: 'User not found' });
    return;
  }
  res.json({
    code: 200,
    message: 'ok',
    data: userResponse(user),
  });
});

// POST /api/auth/change-password
authRoutes.post('/change-password', authMiddleware, async (req: Request, res: Response) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    res.status(400).json({ code: 400, message: 'Old password and new password are required' });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ code: 400, message: 'New password must be at least 6 characters' });
    return;
  }

  const user = findUserByAccount(req.user!.account);
  if (!user) {
    res.status(404).json({ code: 404, message: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(oldPassword, user.password_hash);
  if (!valid) {
    res.status(401).json({ code: 401, message: 'Current password is incorrect' });
    return;
  }

  const hash = await bcrypt.hash(newPassword, 10);
  updatePassword(user.account, hash);

  res.json({ code: 200, message: 'Password changed successfully' });
});

// PUT /api/auth/profile
authRoutes.put('/profile', authMiddleware, (req: Request, res: Response) => {
  const { nickname, email, phone } = req.body;
  updateUserProfile(req.user!.userId, { nickname, email, phone });
  const user = findUserById(req.user!.userId);
  res.json({ code: 200, message: 'Profile updated', data: userResponse(user!) });
});

// POST /api/auth/avatar — upload/update avatar
authRoutes.post('/avatar', authLimiter, authMiddleware, upload.single('avatar'), (req: Request, res: Response) => {
  const accepted = acceptAvatarUpload(req, res);
  if (!accepted) return;
  const avatarUrl = `/avatars/${path.basename(accepted.newPath)}`;

  // Delete old avatar
  const user = findUserById(req.user!.userId);
  if (user?.avatar) {
    const oldPath = path.join(avatarDir, path.basename(user.avatar));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  updateUserProfile(req.user!.userId, { avatar: avatarUrl });
  const updated = findUserById(req.user!.userId);
  res.json({ code: 200, message: 'Avatar updated', data: userResponse(updated!) });
});
