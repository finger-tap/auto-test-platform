import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { findUserByAccount, findUserById, createUser, updatePassword, updateUserProfile } from '../db/users.js';
import { signToken } from '../auth/jwt.js';
import { authMiddleware } from '../auth/middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const avatarDir = path.resolve(__dirname, '../../../data/avatars');

export const authRoutes = Router();

// Multer config for avatar uploads
const upload = multer({
  dest: avatarDir,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    if (/image\/(jpeg|png|gif|webp)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

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
authRoutes.post('/register', upload.single('avatar'), async (req: Request, res: Response) => {
  const { account, password, nickname } = req.body;

  if (!account || typeof account !== 'string' || !account.trim()) {
    res.status(400).json({ code: 400, message: 'Account is required' });
    return;
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
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
    const ext = path.extname(req.file.originalname) || '.png';
    const newName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const newPath = path.join(avatarDir, newName);
    fs.renameSync(req.file.path, newPath);
    avatarPath = `/avatars/${newName}`;
  }

  const hash = await bcrypt.hash(password, 10);
  const userId = createUser(trimmedAccount, hash, undefined, nickname?.trim() || undefined, avatarPath);

  res.status(201).json({ code: 201, message: 'Registration successful', data: { userId } });
});

// POST /api/auth/login
authRoutes.post('/login', async (req: Request, res: Response) => {
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
authRoutes.post('/reset-password', async (req: Request, res: Response) => {
  const { account, newPassword } = req.body;

  if (!account || typeof account !== 'string' || !account.trim()) {
    res.status(400).json({ code: 400, message: 'Account is required' });
    return;
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    res.status(400).json({ code: 400, message: 'New password must be at least 6 characters' });
    return;
  }

  const user = findUserByAccount(account.trim());
  if (!user) {
    res.status(404).json({ code: 404, message: 'Account not found' });
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
authRoutes.post('/avatar', authMiddleware, upload.single('avatar'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ code: 400, message: 'No file uploaded' });
    return;
  }

  const ext = path.extname(req.file.originalname) || '.png';
  const newName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const newPath = path.join(avatarDir, newName);
  fs.renameSync(req.file.path, newPath);
  const avatarUrl = `/avatars/${newName}`;

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
