import { randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getTeamDb } from '../client.js';
import { teamInvites, teamMembers, teams, centerUsers, type TeamInviteRow } from '../schema/org.js';
import { nowSql, isTeamRole, TeamApiError, type TeamRole } from '../util.js';
import { requireRole } from './org.js';
import { writeAudit } from './audit.js';

/**
 * Team invite codes (2026-08-22).
 *
 * Lifecycle: owner/admin creates a code (list anytime, revoke anytime);
 * a logged-in center user redeems it to join the team with the code's role.
 * Codes are NOT secrets in the credential sense - they are visible to
 * owner/admin in full so they can be re-shared months later.
 */

export interface InviteInfo {
  id: number;
  code: string;
  role: TeamRole;
  note: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  revoked: boolean;
  createdBy: number;
  createdAt: string;
  /** derived at read time (revoked / expired / exhausted) */
  status: 'valid' | 'revoked' | 'expired' | 'exhausted';
}

function toInfo(row: TeamInviteRow): InviteInfo {
  const revoked = row.revoked === 1;
  const expired = !!row.expiresAt && row.expiresAt <= nowSql();
  const exhausted = row.maxUses > 0 && row.usedCount >= row.maxUses;
  return {
    id: row.id,
    code: row.code,
    role: (isTeamRole(row.role) ? row.role : 'viewer') as TeamRole,
    note: row.note,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    expiresAt: row.expiresAt,
    revoked,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    status: revoked ? 'revoked' : expired ? 'expired' : exhausted ? 'exhausted' : 'valid',
  };
}

// Unambiguous alphabet (no 0/O/1/I) - codes are typed by humans.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function generateCode(): string {
  const bytes = randomBytes(12);
  let raw = '';
  for (let i = 0; i < 12; i++) raw += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** varchar(32) timestamp "YYYY-MM-DD HH:MM:SS" + N days, or null for never. */
function expiryFromDays(days: number | null | undefined): string | null {
  if (days === null || days === undefined) return null; // never expires
  if (!Number.isInteger(days) || days <= 0 || days > 3650) {
    throw new TeamApiError(400, '有效期天数必须是 1~3650 的整数');
  }
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export async function createInvite(
  teamId: number,
  operatorId: number,
  input: { role?: string; note?: string; maxUses?: number; expiresInDays?: number | null },
): Promise<InviteInfo> {
  await requireRole(teamId, operatorId, 'admin');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');

  const role = isTeamRole(input.role ?? 'editor') ? (input.role as TeamRole) : null;
  if (!role || role === 'owner') throw new TeamApiError(400, '邀请角色必须是 admin / editor / viewer');

  const maxUses = input.maxUses ?? 0;
  if (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > 100_000) {
    throw new TeamApiError(400, '使用次数必须是不限(0)或 1~100000');
  }

  const note = input.note?.trim().slice(0, 128) || null;
  const expiresAt = expiryFromDays(input.expiresInDays ?? null);

  // Retry on the (astronomically unlikely) code collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode();
    try {
      const now = nowSql();
      const result = await db.insert(teamInvites).values({
        teamId,
        code,
        role,
        note,
        maxUses,
        usedCount: 0,
        expiresAt,
        revoked: 0,
        createdBy: operatorId,
        createdAt: now,
      });
      const id = Number(result[0].insertId);
      const row = (await db.select().from(teamInvites).where(eq(teamInvites.id, id)).limit(1))[0];
      return toInfo(row);
    } catch (err) {
      const msg = String(err);
      if (!msg.includes('uk_team_invites_code') && !msg.includes('Duplicate entry')) throw err;
      // collision - loop and retry with a fresh code
    }
  }
  throw new TeamApiError(500, '邀请码生成冲突，请重试');
}

export async function listInvites(teamId: number, operatorId: number): Promise<InviteInfo[]> {
  await requireRole(teamId, operatorId, 'admin');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  const rows = await db
    .select()
    .from(teamInvites)
    .where(eq(teamInvites.teamId, teamId))
    .orderBy(desc(teamInvites.id));
  return rows.map(toInfo);
}

export async function revokeInvite(teamId: number, operatorId: number, inviteId: number): Promise<void> {
  await requireRole(teamId, operatorId, 'admin');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  const result = await db
    .update(teamInvites)
    .set({ revoked: 1 })
    .where(and(eq(teamInvites.id, inviteId), eq(teamInvites.teamId, teamId)));
  if (Number(result[0].affectedRows) === 0) throw new TeamApiError(404, '邀请码不存在');
}

export interface RedeemResult {
  team: { id: number; name: string; description: string | null };
  role: TeamRole;
  memberCount: number;
}

/**
 * Redeem an invite code: join the team with the code's role.
 * Any authenticated center user; no prior relationship with the team needed.
 */
export async function redeemInvite(code: string, userId: number): Promise<RedeemResult> {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');

  const normalized = (code || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/.test(normalized)) {
    throw new TeamApiError(400, '邀请码格式不对（示例：7K2M-QX9D-PL4T）');
  }

  const row = (await db.select().from(teamInvites).where(eq(teamInvites.code, normalized)).limit(1))[0];
  if (!row) throw new TeamApiError(404, '邀请码不存在');
  if (row.revoked === 1) throw new TeamApiError(410, '邀请码已被撤销');
  if (row.expiresAt && row.expiresAt <= nowSql()) throw new TeamApiError(410, '邀请码已过期');
  if (row.maxUses > 0 && row.usedCount >= row.maxUses) throw new TeamApiError(410, '邀请码使用次数已用完');

  const teamId = row.teamId;
  const team = (await db.select().from(teams).where(eq(teams.id, teamId)).limit(1))[0];
  if (!team) throw new TeamApiError(404, '团队不存在');

  // Already a member -> idempotent-friendly 409.
  const existing = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  if (existing[0]) throw new TeamApiError(409, '你已经是该团队成员了');

  const now = nowSql();
  // 2026-08-25: 事务 + 条件 UPDATE 原子占坑 — 此前"读-判-写"三步无事务,
  // 并发兑换同一张 maxUses=1 的码时名额可被超发。条件不满足(撤销/用完/
  // 被并发抢先)时 affectedRows=0, 整体回滚不入队。
  let joined = false;
  try {
    joined = await db.transaction(async (tx) => {
      const upd = await tx
        .update(teamInvites)
        .set({ usedCount: sql`${teamInvites.usedCount} + 1` })
        .where(
          and(
            eq(teamInvites.id, row.id),
            eq(teamInvites.revoked, 0),
            sql`(${teamInvites.maxUses} = 0 OR ${teamInvites.usedCount} < ${teamInvites.maxUses})`,
          ),
        );
      if (Number(upd[0].affectedRows) !== 1) return false;
      await tx.insert(teamMembers).values({ teamId, userId, role: row.role, createdAt: now });
      return true;
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('uk_team_members_team_user') || msg.includes('Duplicate entry')) {
      throw new TeamApiError(409, '你已经是该团队成员了');
    }
    throw err;
  }
  if (!joined) throw new TeamApiError(410, '邀请码使用次数已用完或已被撤销');

  const [mc] = await db.select({ n: sql<number>`count(*)` }).from(teamMembers).where(eq(teamMembers.teamId, teamId));
  const [user] = await db.select({ account: centerUsers.account }).from(centerUsers).where(eq(centerUsers.id, userId)).limit(1);
  void writeAudit({
    teamId,
    projectId: null,
    userId,
    account: user?.account ?? String(userId),
    action: 'create',
    resourceType: 'team_member',
    resourceId: userId,
    resourceName: user?.account ?? String(userId),
    detail: { via: 'invite_code', inviteId: row.id, role: row.role },
  });

  return {
    team: { id: team.id, name: team.name, description: team.description },
    role: (isTeamRole(row.role) ? row.role : 'viewer') as TeamRole,
    memberCount: Number(mc.n),
  };
}
