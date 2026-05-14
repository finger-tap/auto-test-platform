import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'auto-test-platform-dev-secret';
const TOKEN_EXPIRY = '24h';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('Warning: Using default JWT secret in production. Set JWT_SECRET env variable.');
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
