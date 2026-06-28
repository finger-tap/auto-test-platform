// 2026-06-08: mobile-agent bearer auth.
// 跟 web-agent 共享相同的认证逻辑，但独立实现，不依赖 agent-web。
// 原因：mobile-agent 推送时不打包 agent-web 代码，保持隔离。

import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      agentServerToken?: string;
    }
  }
}

/**
 * Agent-side bearer auth. Validates the central server's shared secret.
 * Re-use AGENT_TOKEN as a mutual auth: the server also sends
 * `Authorization: Bearer <AGENT_TOKEN>` on every callback, and the agent
 * matches it against the same env var.
 */
export function verifyServerRequest(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.AGENT_TOKEN;
  if (!expected) {
    res.status(500).json({ code: 500, message: 'Agent not configured (AGENT_TOKEN missing)' });
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ code: 401, message: 'Bearer token required' });
    return;
  }
  const token = authHeader.slice(7).trim();
  if (token !== expected) {
    res.status(401).json({ code: 401, message: 'Invalid token' });
    return;
  }
  req.agentServerToken = token;
  next();
}
