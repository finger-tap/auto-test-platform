import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { findUserByAccount, findUserById, createUser, updatePassword, updateUserProfile } from '../db/users.js';
import { signToken } from '../auth/jwt.js';
import { authMiddleware } from '../auth/middleware.js';

export const authRoutes = Router();

function userResponse(user: { id: number; account: string; account_type: string; nickname: string | null; avatar: string | null }) {
  return {
    userId: user.id,
    account: user.account,
    accountType: user.account_type,
    nickname: user.nickname || user.account.slice(0, 3),
    avatar: user.avatar,
  };
}

// POST /api/auth/register
authRoutes.post('/register', async (req: Request, res: Response) => {
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
    res.status(409).json({ code: 409, message: 'Account already exists' });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const userId = createUser(trimmedAccount, hash, undefined, nickname?.trim() || undefined);

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
  const { nickname, avatar } = req.body;
  updateUserProfile(req.user!.userId, nickname, avatar);
  const user = findUserById(req.user!.userId);
  res.json({ code: 200, message: 'Profile updated', data: userResponse(user!) });
});
