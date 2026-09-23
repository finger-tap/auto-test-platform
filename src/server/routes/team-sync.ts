import { Router, type Request, type Response, type NextFunction } from 'express';
import db from '../db/index.js';
import { teamAuthMiddleware } from './team-auth.js';
import { getMembership } from '../db-team/repo/org.js';
import { findCenterUserById } from '../db-team/repo/auth.js';
import { hasRole, TeamApiError } from '../db-team/util.js';
import { previewForUser, buildPackageForUser } from './export-package.js';

/**
 * /api/team/local-accounts/* - 本地数据同步到团队的桥 (2026-08-23).
 *
 * 用户故事: 团队管理员在团队空间里选择某个本地账号, 把该账号的个人数据
 * (用例/场景/环境/Mock) 打包同步进团队项目。复用 /export-package 的
 * preview/build 逻辑(依赖闭包/脱敏) + /team/import/* 的导入引擎
 * (冲突策略/版本备份/审计), 本路由只负责"以指定本地账号的身份导出"。
 *
 * 权限 (2026-08-25 收紧): 仅平台管理员可同步本地账号数据。此前只要求
 * 目标团队 editor — 而 teamId 由请求方自带, 等于任意注册用户自建团队后
 * 可导出本实例上任何人的个人数据(含可选明文密钥), 远宽于"管理员合并
 * 成员数据"的设计意图。
 */

export const teamSyncRoutes = Router();
teamSyncRoutes.use(teamAuthMiddleware);

function ah(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/** editor+ on the given teamId, else throw. */
async function requireEditor(teamId: number, userId: number): Promise<void> {
  const role = await getMembership(teamId, userId);
  if (!role || !hasRole(role, 'editor')) {
    throw new TeamApiError(403, '需要团队 editor 及以上角色');
  }
}

/** Platform admin only — local-account sync moves OTHER people's data. */
async function requirePlatformAdmin(userId: number): Promise<void> {
  const u = await findCenterUserById(userId);
  if (!u || u.isPlatformAdmin !== 1) {
    throw new TeamApiError(403, '仅平台管理员可同步本地账号数据');
  }
}

interface LocalAccountRow {
  id: number;
  account: string;
  nickname: string | null;
  created_at: string;
}

/** 本实例上的本地账号列表 + 各自资源量 (帮助挑选要同步谁的数据)。 */
teamSyncRoutes.get(
  '/local-accounts',
  ah(async (req, res) => {
    await requirePlatformAdmin(req.teamUser!.userId);
    const users = db
      .prepare(
        `SELECT id, account, nickname, created_at FROM users
         WHERE account != '__team_host__' ORDER BY id`,
      )
      .all() as LocalAccountRow[];

    const count = (table: string, uid: number): number =>
      Number((db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE user_id = ?`).get(uid) as { c: number }).c);

    const accounts = users.map((u) => ({
      id: u.id,
      account: u.account,
      nickname: u.nickname,
      createdAt: u.created_at,
      stats: {
        apis: count('apis', u.id),
        scenarios: count('scenarios', u.id),
        webCases: count('web_test_cases', u.id),
        pcCases: count('pc_test_cases', u.id),
        mobileCases: count('mobile_test_cases', u.id),
        environments: count('environments', u.id),
      },
    }));
    res.json({ code: 200, message: 'ok', data: { accounts } });
  }),
);

/** 指定本地账号的资源树 (同 /export-package/preview, 但按 uid)。 */
teamSyncRoutes.get(
  '/local-accounts/:uid/preview',
  ah(async (req, res) => {
    const uid = Number(req.params.uid);
    const teamId = Number(req.query.teamId);
    if (!Number.isInteger(uid) || !Number.isInteger(teamId)) throw new TeamApiError(400, '参数无效');
    await requirePlatformAdmin(req.teamUser!.userId);
    await requireEditor(teamId, req.teamUser!.userId);

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
    if (!user) throw new TeamApiError(404, '本地账号不存在');
    res.json({ code: 200, message: 'ok', data: previewForUser(uid) });
  }),
);

/** 指定本地账号打包 (依赖闭包 + 可选脱敏), 包交给 /team/import/* 走导入。 */
teamSyncRoutes.post(
  '/local-accounts/:uid/build',
  ah(async (req, res) => {
    const uid = Number(req.params.uid);
    const { teamId, selections, includeSecrets } = (req.body ?? {}) as {
      teamId?: number;
      selections?: Record<string, number[] | undefined>;
      includeSecrets?: boolean;
    };
    if (!Number.isInteger(uid) || !Number.isInteger(teamId)) throw new TeamApiError(400, '参数无效');
    await requirePlatformAdmin(req.teamUser!.userId);
    await requireEditor(teamId, req.teamUser!.userId);

    const user = db.prepare('SELECT id, account FROM users WHERE id = ?').get(uid) as
      | { id: number; account: string }
      | undefined;
    if (!user) throw new TeamApiError(404, '本地账号不存在');

    // 明文密钥默认脱敏; 平台管理员已通过 requirePlatformAdmin, 保留开关。
    const pkg = buildPackageForUser(uid, user.account, selections ?? {}, Boolean(includeSecrets));
    res.json({ code: 200, message: 'ok', data: pkg });
  }),
);

// Error translation (mirror team-extras.ts)
teamSyncRoutes.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof TeamApiError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }
  console.error('[team-sync] unexpected error:', err);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});
