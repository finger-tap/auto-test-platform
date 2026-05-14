import db from './index.js';

export type AccountType = 'email' | 'phone' | 'guest';

export interface UserRow {
  id: number;
  account: string;
  password_hash: string;
  account_type: AccountType;
  nickname: string | null;
  avatar: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export function detectAccountType(account: string): AccountType {
  if (account.includes('@')) return 'email';
  if (/^\+?\d+$/.test(account)) return 'phone';
  return 'email';
}

export function findUserByAccount(account: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE account = ?').get(account) as UserRow | undefined;
}

export function findUserById(id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function createUser(account: string, passwordHash: string, accountType?: AccountType, nickname?: string, avatar?: string): number {
  const type = accountType || detectAccountType(account);
  const result = db.prepare('INSERT INTO users (account, password_hash, account_type, nickname, avatar) VALUES (?, ?, ?, ?, ?)').run(account, passwordHash, type, nickname || null, avatar || null);
  return result.lastInsertRowid as number;
}

export function updatePassword(account: string, newPasswordHash: string): void {
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE account = ?").run(newPasswordHash, account);
}

export function updateUserProfile(userId: number, data: { nickname?: string; avatar?: string; email?: string; phone?: string }): void {
  const fields: string[] = [];
  const values: (string | null)[] = [];
  if (data.nickname !== undefined) { fields.push('nickname = ?'); values.push(data.nickname || null); }
  if (data.avatar !== undefined) { fields.push('avatar = ?'); values.push(data.avatar || null); }
  if (data.email !== undefined) { fields.push('email = ?'); values.push(data.email || null); }
  if (data.phone !== undefined) { fields.push('phone = ?'); values.push(data.phone || null); }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values, userId);
}
