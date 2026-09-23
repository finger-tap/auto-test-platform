import { Router, type Request, type Response, type NextFunction } from 'express';
import { teamAuthMiddleware } from './team-auth.js';
import {
  listMyTeams,
  createTeam,
  getTeamDetail,
  updateTeam,
  deleteTeam,
  listMembers,
  addMember,
  updateMemberRole,
  removeMember,
  listProjects,
  createProject,
  updateProject,
  deleteProject,
} from '../db-team/repo/org.js';
import { createInvite, listInvites, revokeInvite, redeemInvite } from '../db-team/repo/invites.js';
import { TeamApiError } from '../db-team/util.js';

/**
 * /api/team/* organization routes — teams, members, projects.
 * All routes require center auth (teamAuthMiddleware) and a ready team DB
 * (teamDbGuard, mounted in routes/index.ts before this router).
 */

export const teamOrgRoutes = Router();
teamOrgRoutes.use(teamAuthMiddleware);

function ah(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

function parseId(v: string | undefined, label: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new TeamApiError(400, `无效的${label} ID`);
  return n;
}

// ── teams ───────────────────────────────────────────────────────────────────

teamOrgRoutes.get(
  '/teams',
  ah(async (req, res) => {
    const list = await listMyTeams(req.teamUser!.userId);
    res.json({ code: 200, message: 'ok', data: { teams: list } });
  }),
);

teamOrgRoutes.post(
  '/teams',
  ah(async (req, res) => {
    const { name, description } = req.body || {};
    if (typeof name !== 'string') {
      res.status(400).json({ code: 400, message: '团队名称不能为空' });
      return;
    }
    const team = await createTeam({ name, description, userId: req.teamUser!.userId });
    res.status(201).json({ code: 201, message: '创建成功', data: { team } });
  }),
);

teamOrgRoutes.get(
  '/teams/:teamId',
  ah(async (req, res) => {
    const teamId = parseId(req.params.teamId, '团队');
    const team = await getTeamDetail(teamId, req.teamUser!.userId);
    res.json({ code: 200, message: 'ok', data: { team } });
  }),
);

teamOrgRoutes.put(
  '/teams/:teamId',
  ah(async (req, res) => {
    const teamId = parseId(req.params.teamId, '团队');
    const { name, description } = req.body || {};
    const team = await updateTeam(teamId, req.teamUser!.userId, { name, description });
    res.json({ code: 200, message: '更新成功', data: { team } });
  }),
);

teamOrgRoutes.delete(
  '/teams/:teamId',
  ah(async (req, res) => {
    const teamId = parseId(req.params.teamId, '团队');
    // 先清本地镜像再删团队行(删完就查不到该团队的资源 id 列表了) —
    // 失败不阻塞团队删除, 只留日志
    try {
      const { removeMirrorsForTeam } = await import('./team-execute.js');
      await removeMirrorsForTeam(teamId);
    } catch (err) {
      console.error(`[team-org] removeMirrorsForTeam(${teamId}) failed:`, err);
    }
    await deleteTeam(teamId, req.teamUser!.userId);
    res.json({ code: 200, message: '已删除', data: null });
  }),
);

// ── members ─────────────────────────────────────────────────────────────────

teamOrgRoutes.get(
  '/teams/:teamId/members',
  ah(async (req, res) => {
    const teamId = parseId(req.params.teamId, '团队');
    const members = await listMembers(teamId, req.teamUser!.userId);
    res.json({ code: 200, message: 'ok', data: { members } });
  }),
);

teamOrgRoutes.post(
  '/teams/:teamId/members',
  ah(async (req, res) => {
    const teamId = parseId(req.params.teamId, '团队');
    const { account, role } = req.body || {};
    if (typeof account !== 'string') {
      res.status(400).json({ code: 400, message: '账号不能为空' });
      return;
    }
    const member = await addMember(teamId, req.teamUser!.userId, account, role ?? 'editor');
    res.status(201).json({ code: 201, message: '添加成功', data: { member } });
  }),
);

teamOrgRoutes.put(
  '/teams/:teamId/members/:userId',
  ah(async (req, res) => {
    const teamId = parseId(req.params.teamId, '团队');
    const targetUserId = parseId(req.params.userId, '用户');
    const { role } = req.body || {};
    if (typeof role !== 'string') {
      res.status(400).json({ code: 400, message: '角色不能为空' });
      return;
    }
    await updateMemberRole(teamId, req.teamUser!.userId, targetUserId, role);
    res.json({ code: 200, message: '更新成功', data: null });
  }),
);

teamOrgRoutes.delete(
  '/teams/:teamId/members/:userId',
  ah(async (req, res) => {
    const teamId = parseId(req.params.teamId, '团队');
    const targetUserId = parseId(req.params.userId, '用户');
    await removeMember(teamId, req.teamUser!.userId, targetUserId);
    res.json({ code: 200, message: '已移除', data: null });
  }),
);

// ── invites（邀请码）────────────────────────────────────────────────────────

teamOrgRoutes.get(
  '/teams/:teamId/invites',
  ah(async (req, res) => {
    const teamId = parseId(req.params.teamId, '团队');
    const invites = await listInvites(teamId, req.teamUser!.userId);
    res.json({ code: 200, message: 'ok', data: { invites } });
  }),
);

teamOrgRoutes.post(
  '/teams/:teamId/invites',
  ah(async (req, res) => {
    const teamId = parseId(req.params.teamId, '团队');
    const { role, note, maxUses, expiresInDays } = req.body || {};
    const invite = await createInvite(teamId, req.teamUser!.userId, {
      role: typeof role === 'string' ? role : undefined,
      note: typeof note === 'string' ? note : undefined,
      maxUses: typeof maxUses === 'number' ? maxUses : undefined,
      // null/undefined = 永不过期（默认）；数字 = N 天后过期
      expiresInDays: expiresInDays === null ? null : typeof expiresInDays === 'number' ? expiresInDays : undefined,
    });
    res.status(201).json({ code: 201, message: '邀请码已生成', data: { invite } });
  }),
);

teamOrgRoutes.delete(
  '/teams/:teamId/invites/:inviteId',
  ah(async (req, res) => {
    const teamId = parseId(req.params.teamId, '团队');
    const inviteId = parseId(req.params.inviteId, '邀请码');
    await revokeInvite(teamId, req.teamUser!.userId, inviteId);
    res.json({ code: 200, message: '已撤销', data: null });
  }),
);

// Redeem: any logged-in center user joins a team by code. NOTE: mounted
// before the member-add route on purpose? No - different path, order is
// irrelevant. But it MUST stay outside teams/:teamId so no membership is
// required to call it.
teamOrgRoutes.post(
  '/invites/redeem',
  ah(async (req, res) => {
    const { code } = req.body || {};
    if (typeof code !== 'string' || !code.trim()) {
      res.status(400).json({ code: 400, message: '邀请码不能为空' });
      return;
    }
    const result = await redeemInvite(code, req.teamUser!.userId);
    res.status(201).json({ code: 201, message: `已加入团队「${result.team.name}」`, data: result });
  }),
);

// ── projects ────────────────────────────────────────────────────────────────

teamOrgRoutes.get(
  '/teams/:teamId/projects',
  ah(async (req, res) => {
    const teamId = parseId(req.params.teamId, '团队');
    const projects = await listProjects(teamId, req.teamUser!.userId);
    res.json({ code: 200, message: 'ok', data: { projects } });
  }),
);

teamOrgRoutes.post(
  '/teams/:teamId/projects',
  ah(async (req, res) => {
    const teamId = parseId(req.params.teamId, '团队');
    const { name, description } = req.body || {};
    if (typeof name !== 'string') {
      res.status(400).json({ code: 400, message: '项目名称不能为空' });
      return;
    }
    const project = await createProject(teamId, req.teamUser!.userId, { name, description });
    res.status(201).json({ code: 201, message: '创建成功', data: { project } });
  }),
);

teamOrgRoutes.put(
  '/projects/:projectId',
  ah(async (req, res) => {
    const projectId = parseId(req.params.projectId, '项目');
    const { name, description } = req.body || {};
    const project = await updateProject(projectId, req.teamUser!.userId, { name, description });
    res.json({ code: 200, message: '更新成功', data: { project } });
  }),
);

teamOrgRoutes.delete(
  '/projects/:projectId',
  ah(async (req, res) => {
    const projectId = parseId(req.params.projectId, '项目');
    await deleteProject(projectId, req.teamUser!.userId);
    res.json({ code: 200, message: '已删除', data: null });
  }),
);

// TeamApiError → JSON
teamOrgRoutes.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof TeamApiError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }
  console.error('[team-org] unexpected error:', err);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});
