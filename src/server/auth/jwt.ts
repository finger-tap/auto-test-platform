import jwt from 'jsonwebtoken';

const JWT_SECRET_ENV = process.env.JWT_SECRET;
const JWT_SECRET = JWT_SECRET_ENV || (process.env.NODE_ENV === 'production' ? '' : 'auto-test-platform-dev-secret-only-for-local');
const TOKEN_EXPIRY = '24h';

if (!JWT_SECRET_ENV) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production. Refusing to start with a default secret.');
  }
  console.warn('[jwt] Using default dev JWT secret. Set JWT_SECRET env variable before deploying.');
} else if (JWT_SECRET_ENV.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.');
}

export interface TokenPayload {
  userId: number;
  account: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}
