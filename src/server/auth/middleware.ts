import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './jwt.js';

declare global {
  namespace Express {
    interface Request {
      user?: { userId: number; account: string };
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ code: 401, message: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ code: 401, message: 'Invalid or expired token' });
    return;
  }

  req.user = { userId: payload.userId, account: payload.account };
  next();
}
