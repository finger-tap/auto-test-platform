import { Router, type Request, type Response, type NextFunction } from 'express';
import { verifyTeamToken, signTeamToken } from '../auth/team-jwt.js';
import { isTeamDbEnabled, isTeamReady, teamDbPing } from '../db-team/client.js';
import {
  createCenterUser,
  verifyCenterPassword,
  findCenterUserById,
  toPublicUser,
} from '../db-team/repo/auth.js';
import { TeamApiError } from '../db-team/util.js';

declare global {
  namespace Express {
    interface Request {
      // Center-server user context (teamAuthMiddleware). Independent from
      // `user` (local instance auth) — a request carries one or the other.
      teamUser?: { userId: number; account: string };
    }
  }
}

/**
 * /api/team/auth/* — center-server account endpoints.
 * /api/team/ping    — liveness probe, NO auth, NO DB dependency. Used by the
 *                     ConnectTeamModal to validate a center URL before login.
 */

export const teamAuthRoutes = Router();

/** Async handler + TeamApiError → JSON translation (mirrors local route style). */
function ah(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/** Mounted on all /team/auth/* routes (after ping). */
export function teamAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ code: 401, message: '需要团队登录' });
    return;
  }
  const payload = verifyTeamToken(header.slice(7));
  if (!payload) {
    res.status(401).json({ code: 401, message: '团队登录已失效，请重新连接团队' });
    return;
  }
  req.teamUser = { userId: payload.userId, account: payload.account };
  next();
}

// ── ping (no auth, no db) ───────────────────────────────────────────────────

export async function teamPingHandler(_req: Request, res: Response) {
  const configured = isTeamDbEnabled();
  const ready = configured && isTeamReady();
  let dbOk = false;
  if (ready) dbOk = await teamDbPing();
  res.json({
    code: 200,
    message: 'ok',
    data: {
      server: 'autotest-center',
      teamDbConfigured: configured,
      teamReady: ready,
      dbOk,
    },
  });
}

// ── register / login / me ───────────────────────────────────────────────────

teamAuthRoutes.post(
  '/register',
  ah(async (req, res) => {
    const { account, password, nickname } = req.body || {};
    if (typeof account !== 'string' || !account.trim()) {
      res.status(400).json({ code: 400, message: '账号不能为空' });
      return;
    }
    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ code: 400, message: '密码至少 6 位' });
      return;
    }
    const user = await createCenterUser({ account: account.trim(), password, nickname });
    res.status(201).json({ code: 201, message: '注册成功', data: { user } });
  }),
);

teamAuthRoutes.post(
  '/login',
  ah(async (req, res) => {
    const { account, password } = req.body || {};
    if (typeof account !== 'string' || typeof password !== 'string') {
      res.status(400).json({ code: 400, message: '账号和密码不能为空' });
      return;
    }
    const user = await verifyCenterPassword(account, password);
    const token = signTeamToken({ userId: user.id, account: user.account });
    res.json({ code: 200, message: '登录成功', data: { token, user: toPublicUser(user) } });
  }),
);

teamAuthRoutes.get(
  '/me',
  teamAuthMiddleware,
  ah(async (req, res) => {
    const user = await findCenterUserById(req.teamUser!.userId);
    if (!user) {
      res.status(401).json({ code: 401, message: '账号不存在' });
      return;
    }
    res.json({ code: 200, message: 'ok', data: { user: toPublicUser(user) } });
  }),
);

// Express error handler translating TeamApiError for this router.
teamAuthRoutes.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof TeamApiError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }
  console.error('[team-auth] unexpected error:', err);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});
