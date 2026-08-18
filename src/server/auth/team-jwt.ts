import jwt from 'jsonwebtoken';

/**
 * Center-server JWT — deliberately separate from the local-instance JWT
 * (src/server/auth/jwt.ts):
 *
 * - separate secret (TEAM_JWT_SECRET), so a leaked local dev secret can never
 *   mint center tokens
 * - separate payload type (teamUserId) to avoid accidental cross-use
 * - the local frontend stores center tokens under their own localStorage key
 *   (teamAuth:<centerUrl>) and only attaches them to requests that target the
 *   center server — see client/utils/api.ts resolveTarget()
 */

const SECRET_ENV = process.env.TEAM_JWT_SECRET;
const SECRET =
  SECRET_ENV ||
  (process.env.NODE_ENV === 'production' ? '' : 'auto-test-platform-team-dev-secret-only-for-local');
const TOKEN_EXPIRY = '24h';

if (!SECRET_ENV) {
  // Only hard-fail when this deployment actually intends to serve the team
  // feature (DB_URL configured). A production LOCAL instance without team
  // support must still boot.
  if (process.env.NODE_ENV === 'production' && process.env.DB_URL) {
    throw new Error('TEAM_JWT_SECRET environment variable is required when running the center server (DB_URL set) in production.');
  }
  console.warn('[team-jwt] Using default dev secret. Set TEAM_JWT_SECRET before deploying the center server.');
} else if (SECRET_ENV.length < 32) {
  throw new Error('TEAM_JWT_SECRET must be at least 32 characters long.');
}

export interface TeamTokenPayload {
  userId: number;
  account: string;
}

export function signTeamToken(payload: TeamTokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyTeamToken(token: string): TeamTokenPayload | null {
  try {
    return jwt.verify(token, SECRET) as TeamTokenPayload;
  } catch {
    return null;
  }
}
