// 2026-07-01: pc-agent bearer auth — same shared-secret model as the other
// agents, but kept self-contained so pc-agent's bundle has zero dependency
// on agent-web source. AGENT_TOKEN is injected by the launchd plist /
// systemd unit at deploy time from devices.agent_token. Mutual: server →
// agent and agent → server both carry `Bearer <AGENT_TOKEN>`.

import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      agentServerToken?: string;
    }
  }
}

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