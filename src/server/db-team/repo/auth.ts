import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { getTeamDb } from '../client.js';
import { centerUsers, type CenterUserRow } from '../schema/org.js';
import { nowSql, TeamApiError } from '../util.js';

/**
 * center_users data access. Same bcryptjs hashing as the local auth stack so
 * operational knowledge transfers; accounts are independent per deployment.
 */

export type AccountType = 'email' | 'phone';

export function detectAccountType(account: string): AccountType {
  if (account.includes('@')) return 'email';
  if (/^\+?\d+$/.test(account)) return 'phone';
  return 'email';
}

function maskUser(row: CenterUserRow) {
  // Never leak password_hash to any API response.
  const { passwordHash: _ph, ...rest } = row;
  return rest;
}

export type PublicCenterUser = ReturnType<typeof maskUser>;

export async function findCenterUserByAccount(account: string): Promise<CenterUserRow | undefined> {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  const rows = await db.select().from(centerUsers).where(eq(centerUsers.account, account)).limit(1);
  return rows[0];
}

export async function findCenterUserById(id: number): Promise<CenterUserRow | undefined> {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  const rows = await db.select().from(centerUsers).where(eq(centerUsers.id, id)).limit(1);
  return rows[0];
}

export async function createCenterUser(input: {
  account: string;
  password: string;
  nickname?: string;
}): Promise<PublicCenterUser> {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');

  const existing = await findCenterUserByAccount(input.account);
  if (existing) throw new TeamApiError(409, '该账号已被注册');

  // Bootstrap: on a fresh deployment the FIRST registered account becomes
  // the platform admin (no built-in credentials - safer than a fixed admin
  // account that port scanners would try first).
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(centerUsers);
  const isPlatformAdmin = Number(n) === 0 ? 1 : 0;

  const now = nowSql();
  const passwordHash = await bcrypt.hash(input.password, 10);
  const inserted = await db
    .insert(centerUsers)
    .values({
      account: input.account,
      passwordHash,
      accountType: detectAccountType(input.account),
      nickname: input.nickname || null,
      isPlatformAdmin,
      createdAt: now,
      updatedAt: now,
    });
  const id = Number(inserted[0].insertId);
  const row = (await db.select().from(centerUsers).where(eq(centerUsers.id, id)).limit(1))[0];
  return maskUser(row);
}

/**
 * Team-creation policy for this deployment (env-configurable):
 *   'admin' (default) - only platform admins may create teams; everyone
 *                        else joins via invite codes (company model).
 *   'self'             - any center account may create its own team
 *                        (community/self-service model).
 */
export function getTeamCreatePolicy(): 'admin' | 'self' {
  return process.env.TEAM_CREATE_POLICY === 'self' ? 'self' : 'admin';
}

export async function verifyCenterPassword(account: string, password: string): Promise<CenterUserRow> {
  const user = await findCenterUserByAccount(account);
  if (!user) throw new TeamApiError(401, '账号或密码错误');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new TeamApiError(401, '账号或密码错误');
  return user;
}

export function toPublicUser(row: CenterUserRow): PublicCenterUser {
  return maskUser(row);
}
