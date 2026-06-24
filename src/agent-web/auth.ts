// 2026-06-06: agent-side bearer token verification.
//
// The agent receives its token via the AGENT_TOKEN env var. Every request
// to the central server carries `Authorization: Bearer <token>`. The
// server-side `agentAuthMiddleware` looks up the token in `devices` and
// grants the agent access to /api/agents/* routes only.
//
// The agent does NOT verify tokens of incoming requests — it issues its
// own bearer for the central server to verify on the agent's HTTP server.
// (Mirror auth: agent verifies server-issued token, server verifies
// agent-issued token, but in this v1 the only inbound requests to the
// agent are from the central server itself, so a single shared token
// works.)

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
 * For v1 we re-use AGENT_TOKEN as a mutual auth: the server also sends
 * `Authorization: Bearer <AGENT_TOKEN>` on every callback, and the agent
 * matches it against the same env var. This is symmetric and avoids a
 * second secret.
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
