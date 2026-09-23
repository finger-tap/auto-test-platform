import { and, eq, sql, desc, asc } from 'drizzle-orm';
import { getTeamDb } from '../client.js';
import { teams, teamMembers, projects, centerUsers, type TeamRow, type ProjectRow } from '../schema/org.js';
import { nowSql, hasRole, isTeamRole, TeamApiError, type TeamRole } from '../util.js';
import { getTeamCreatePolicy } from './auth.js';

/**
 * Teams / members / projects data access with role enforcement.
 *
 * Role model (team-level, projects inherit):
 *   owner  — manage members, delete team, everything below
 *   admin  — manage members (except owner), manage projects & devices
 *   editor — create/edit resources, execute
 *   viewer — read + execute
 */

export interface TeamSummary {
  id: number;
  name: string;
  description: string | null;
  role: TeamRole;
  memberCount: number;
  projectCount: number;
  createdAt: string;
}

export interface TeamMemberInfo {
  userId: number;
  account: string;
  nickname: string | null;
  avatar: string | null;
  role: TeamRole;
  joinedAt: string;
}

export interface ProjectInfo {
  id: number;
  teamId: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── membership helpers ─────────────────────────────────────────────────────

export async function getMembership(teamId: number, userId: number): Promise<TeamRole | null> {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  const rows = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  const role = rows[0]?.role;
  return isTeamRole(role) ? role : null;
}

/** Throws 404 (not a member) / 403 (insufficient role) unless the caller passes. */
export async function requireRole(teamId: number, userId: number, min: TeamRole): Promise<TeamRole> {
  const role = await getMembership(teamId, userId);
  if (!role) throw new TeamApiError(404, '团队不存在或你不是该团队成员');
  if (!hasRole(role, min)) throw new TeamApiError(403, '权限不足（需要 ' + min + ' 及以上角色）');
  return role;
}

export async function getTeamRow(teamId: number): Promise<TeamRow> {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  const rows = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!rows[0]) throw new TeamApiError(404, '团队不存在');
  return rows[0];
}

// ── teams ──────────────────────────────────────────────────────────────────

export async function listMyTeams(userId: number): Promise<TeamSummary[]> {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      description: teams.description,
      createdAt: teams.createdAt,
      role: teamMembers.role,
      memberCount: sql<number>`(select count(*) from ${teamMembers} where ${teamMembers.teamId} = ${teams.id})`,
      projectCount: sql<number>`(select count(*) from ${projects} where ${projects.teamId} = ${teams.id})`,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teams.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    role: (isTeamRole(r.role) ? r.role : 'viewer') as TeamRole,
    memberCount: Number(r.memberCount),
    projectCount: Number(r.projectCount),
    createdAt: r.createdAt,
  }));
}

export async function createTeam(input: { name: string; description?: string; userId: number }): Promise<TeamSummary> {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  const name = input.name.trim();
  if (!name) throw new TeamApiError(400, '团队名称不能为空');
  if (name.length > 128) throw new TeamApiError(400, '团队名称过长（≤128 字符）');

  // Team-creation policy (2026-08-22): default 'admin' = only the platform
  // admin (first account registered on this deployment) may create teams;
  // everyone else joins via invite codes. Set TEAM_CREATE_POLICY=self to
  // re-enable community-style self-service team creation.
  if (getTeamCreatePolicy() === 'admin') {
    const [u] = await db
      .select({ isPlatformAdmin: centerUsers.isPlatformAdmin })
      .from(centerUsers)
      .where(eq(centerUsers.id, input.userId))
      .limit(1);
    if (!u || u.isPlatformAdmin !== 1) {
      throw new TeamApiError(403, '当前部署仅平台管理员可创建团队，普通成员请通过邀请码加入（TEAM_CREATE_POLICY 可调整）');
    }
  }

  const dup = await db.select({ id: teams.id }).from(teams).where(eq(teams.name, name)).limit(1);
  if (dup[0]) throw new TeamApiError(409, '同名团队已存在');

  const now = nowSql();
  const result = await db.insert(teams).values({
    name,
    description: input.description?.trim() || null,
    createdBy: input.userId,
    createdAt: now,
    updatedAt: now,
  });
  const teamId = Number(result[0].insertId);
  await db.insert(teamMembers).values({
    teamId,
    userId: input.userId,
    role: 'owner',
    createdAt: now,
  });
  return {
    id: teamId,
    name,
    description: input.description?.trim() || null,
    role: 'owner',
    memberCount: 1,
    projectCount: 0,
    createdAt: now,
  };
}

export async function updateTeam(teamId: number, userId: number, input: { name?: string; description?: string }): Promise<TeamRow> {
  await requireRole(teamId, userId, 'admin');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');

  const patch: Partial<{ name: string; description: string | null; updatedAt: string }> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new TeamApiError(400, '团队名称不能为空');
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description.trim() || null;
  if (Object.keys(patch).length === 0) return getTeamRow(teamId);
  patch.updatedAt = nowSql();

  if (patch.name) {
    const dup = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.name, patch.name), sql`${teams.id} <> ${teamId}`))
      .limit(1);
    if (dup[0]) throw new TeamApiError(409, '同名团队已存在');
  }

  await db.update(teams).set(patch).where(eq(teams.id, teamId));
  return getTeamRow(teamId);
}

export async function deleteTeam(teamId: number, userId: number): Promise<void> {
  const role = await requireRole(teamId, userId, 'owner');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  // FK cascades (team_members, projects) clean children; Phase-2 business
  // tables will FK-reference projects with cascade as well.
  await db.delete(teams).where(eq(teams.id, teamId));
  void role;
}

export async function getTeamDetail(teamId: number, userId: number): Promise<TeamSummary> {
  const role = await getMembership(teamId, userId);
  if (!role) throw new TeamApiError(404, '团队不存在或你不是该团队成员');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  const row = await getTeamRow(teamId);
  const [mc] = await db
    .select({ n: sql<number>`count(*)` })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));
  const [pc] = await db.select({ n: sql<number>`count(*)` }).from(projects).where(eq(projects.teamId, teamId));
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    role,
    memberCount: Number(mc.n),
    projectCount: Number(pc.n),
    createdAt: row.createdAt,
  };
}

// ── members ────────────────────────────────────────────────────────────────

export async function listMembers(teamId: number, userId: number): Promise<TeamMemberInfo[]> {
  await requireRole(teamId, userId, 'viewer');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  const rows = await db
    .select({
      userId: teamMembers.userId,
      role: teamMembers.role,
      joinedAt: teamMembers.createdAt,
      account: centerUsers.account,
      nickname: centerUsers.nickname,
      avatar: centerUsers.avatar,
    })
    .from(teamMembers)
    .innerJoin(centerUsers, eq(centerUsers.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(teamMembers.id));
  return rows.map((r) => ({
    userId: r.userId,
    account: r.account,
    nickname: r.nickname,
    avatar: r.avatar,
    role: (isTeamRole(r.role) ? r.role : 'viewer') as TeamRole,
    joinedAt: r.joinedAt,
  }));
}

/** Add an existing center user to the team by account. */
export async function addMember(teamId: number, operatorId: number, account: string, role: string): Promise<TeamMemberInfo> {
  await requireRole(teamId, operatorId, 'admin');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');

  const targetRole = isTeamRole(role) ? role : null;
  if (!targetRole || targetRole === 'owner') throw new TeamApiError(400, '角色必须是 admin / editor / viewer');
  if (!account.trim()) throw new TeamApiError(400, '账号不能为空');

  const target = await db.select().from(centerUsers).where(eq(centerUsers.account, account.trim())).limit(1);
  if (!target[0]) throw new TeamApiError(404, '该账号尚未在中心服务注册');

  const existing = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, target[0].id)))
    .limit(1);
  if (existing[0]) throw new TeamApiError(409, '该用户已是团队成员');

  const now = nowSql();
  await db.insert(teamMembers).values({ teamId, userId: target[0].id, role: targetRole, createdAt: now });
  return {
    userId: target[0].id,
    account: target[0].account,
    nickname: target[0].nickname,
    avatar: target[0].avatar,
    role: targetRole,
    joinedAt: now,
  };
}

export async function updateMemberRole(teamId: number, operatorId: number, targetUserId: number, role: string): Promise<void> {
  await requireRole(teamId, operatorId, 'admin');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');

  const newRole = isTeamRole(role) ? role : null;
  if (!newRole || newRole === 'owner') throw new TeamApiError(400, '角色必须是 admin / editor / viewer');

  const current = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
    .limit(1);
  if (!current[0]) throw new TeamApiError(404, '该用户不是团队成员');
  if (current[0].role === 'owner') throw new TeamApiError(403, '不能修改所有者的角色');

  await db
    .update(teamMembers)
    .set({ role: newRole })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));
}

export async function removeMember(teamId: number, operatorId: number, targetUserId: number): Promise<void> {
  await requireRole(teamId, operatorId, 'admin');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');

  const current = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
    .limit(1);
  if (!current[0]) throw new TeamApiError(404, '该用户不是团队成员');
  if (current[0].role === 'owner') throw new TeamApiError(403, '不能移除所有者');
  if (targetUserId === operatorId) throw new TeamApiError(400, '不能移除自己（如需退出请联系管理员）');

  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));
}

// ── projects ───────────────────────────────────────────────────────────────

function toProjectInfo(row: ProjectRow): ProjectInfo {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listProjects(teamId: number, userId: number): Promise<ProjectInfo[]> {
  await requireRole(teamId, userId, 'viewer');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.teamId, teamId))
    .orderBy(asc(projects.id));
  return rows.map(toProjectInfo);
}

export async function createProject(teamId: number, userId: number, input: { name: string; description?: string }): Promise<ProjectInfo> {
  await requireRole(teamId, userId, 'editor');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');

  const name = input.name.trim();
  if (!name) throw new TeamApiError(400, '项目名称不能为空');
  if (name.length > 128) throw new TeamApiError(400, '项目名称过长（≤128 字符）');

  const dup = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.teamId, teamId), eq(projects.name, name)))
    .limit(1);
  if (dup[0]) throw new TeamApiError(409, '同名项目已存在');

  const now = nowSql();
  const result = await db.insert(projects).values({
    teamId,
    name,
    description: input.description?.trim() || null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  const id = Number(result[0].insertId);
  const row = (await db.select().from(projects).where(eq(projects.id, id)).limit(1))[0];
  return toProjectInfo(row);
}

export async function getProjectRow(projectId: number): Promise<ProjectRow> {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  const rows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!rows[0]) throw new TeamApiError(404, '项目不存在');
  return rows[0];
}

export async function updateProject(projectId: number, userId: number, input: { name?: string; description?: string }): Promise<ProjectInfo> {
  const row = await getProjectRow(projectId);
  await requireRole(row.teamId, userId, 'editor');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');

  const patch: Partial<{ name: string; description: string | null; updatedAt: string }> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new TeamApiError(400, '项目名称不能为空');
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description.trim() || null;
  if (Object.keys(patch).length === 0) return toProjectInfo(row);
  patch.updatedAt = nowSql();

  if (patch.name) {
    const dup = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.teamId, row.teamId), eq(projects.name, patch.name), sql`${projects.id} <> ${projectId}`))
      .limit(1);
    if (dup[0]) throw new TeamApiError(409, '同名项目已存在');
  }

  await db.update(projects).set(patch).where(eq(projects.id, projectId));
  return toProjectInfo(await getProjectRow(projectId));
}

export async function deleteProject(projectId: number, userId: number): Promise<void> {
  const row = await getProjectRow(projectId);
  await requireRole(row.teamId, userId, 'admin');
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  await db.delete(projects).where(eq(projects.id, projectId));
}

/** Resolve projectId → { teamId, name } with membership check (used by Phase-2 business routes). */
export async function resolveProjectScope(projectId: number, userId: number): Promise<{ teamId: number; projectName: string }> {
  const row = await getProjectRow(projectId);
  await requireRole(row.teamId, userId, 'viewer');
  return { teamId: row.teamId, projectName: row.name };
}

void desc; // keep import surface stable
