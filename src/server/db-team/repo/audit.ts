import { and, desc, eq } from 'drizzle-orm';
import { getTeamDb } from '../client.js';
import { tAuditLogs, tNotifyChannels } from '../schema/index.js';
import { nowSql, TeamApiError } from '../util.js';

/**
 * Audit log + webhook notifications. Both are fire-and-forget friendly:
 * failures never break the main request.
 */

export async function writeAudit(input: {
  teamId: number;
  projectId: number | null;
  userId: number;
  account: string;
  action: 'create' | 'update' | 'delete' | 'import' | 'rollback';
  resourceType: string;
  resourceId: number | null;
  resourceName?: string | null;
  detail?: unknown;
}): Promise<void> {
  try {
    const db = getTeamDb();
    if (!db) return;
    await db.insert(tAuditLogs).values({
      team_id: input.teamId,
      project_id: input.projectId,
      user_id: input.userId,
      account: input.account,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      resource_name: input.resourceName?.slice(0, 250) ?? null,
      detail: input.detail === undefined ? null : JSON.stringify(input.detail).slice(0, 100_000),
      created_at: nowSql(),
    });
  } catch (err) {
    console.error('[team-audit] write failed:', err);
  }
}

export async function listAudit(
  teamId: number,
  opts: { projectId?: number | null; limit?: number; resourceType?: string } = {},
) {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用');
  const conds = [eq(tAuditLogs.team_id, teamId)];
  if (opts.projectId) conds.push(eq(tAuditLogs.project_id, opts.projectId));
  if (opts.resourceType) conds.push(eq(tAuditLogs.resource_type, opts.resourceType));
  return db
    .select()
    .from(tAuditLogs)
    .where(and(...conds))
    .orderBy(desc(tAuditLogs.id))
    .limit(Math.min(opts.limit ?? 100, 500));
}

// ── notify channels ────────────────────────────────────────────────────────

export async function listChannels(teamId: number) {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用');
  return db.select().from(tNotifyChannels).where(eq(tNotifyChannels.team_id, teamId)).orderBy(desc(tNotifyChannels.id));
}

export async function createChannel(teamId: number, userId: number, input: {
  name: string; type: string; webhook_url: string; secret?: string; events?: string[]; enabled?: boolean;
}) {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用');
  const valid = ['feishu', 'dingtalk', 'wecom', 'slack', 'custom'];
  if (!valid.includes(input.type)) throw new TeamApiError(400, `type 必须是 ${valid.join(' / ')}`);
  if (!/^https?:\/\//.test(input.webhook_url || '')) throw new TeamApiError(400, 'webhook_url 必须是 http(s) 地址');
  const now = nowSql();
  const res = await db.insert(tNotifyChannels).values({
    team_id: teamId,
    name: input.name.slice(0, 120),
    type: input.type,
    webhook_url: input.webhook_url,
    secret: input.secret || null,
    events: JSON.stringify(input.events ?? ['resource.update', 'resource.delete']),
    enabled: input.enabled === false ? 0 : 1,
    created_by: userId,
    created_at: now,
    updated_at: now,
  });
  const id = Number(res[0].insertId);
  return (await db.select().from(tNotifyChannels).where(eq(tNotifyChannels.id, id)).limit(1))[0];
}

export async function updateChannel(teamId: number, id: number, input: Partial<{
  name: string; webhook_url: string; secret: string; events: string[]; enabled: boolean;
}>) {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用');
  const patch: Record<string, unknown> = { updated_at: nowSql() };
  if (input.name !== undefined) patch.name = input.name.slice(0, 120);
  if (input.webhook_url !== undefined) patch.webhook_url = input.webhook_url;
  if (input.secret !== undefined) patch.secret = input.secret || null;
  if (input.events !== undefined) patch.events = JSON.stringify(input.events);
  if (input.enabled !== undefined) patch.enabled = input.enabled ? 1 : 0;
  await db.update(tNotifyChannels).set(patch).where(and(eq(tNotifyChannels.id, id), eq(tNotifyChannels.team_id, teamId)));
  return (await db.select().from(tNotifyChannels).where(eq(tNotifyChannels.id, id)).limit(1))[0];
}

export async function deleteChannel(teamId: number, id: number) {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用');
  await db.delete(tNotifyChannels).where(and(eq(tNotifyChannels.id, id), eq(tNotifyChannels.team_id, teamId)));
}

/** Fire-and-forget webhook fan-out. Never throws. */
export async function notifyResourceEvent(input: {
  teamId: number;
  event: 'resource.create' | 'resource.update' | 'resource.delete' | 'import';
  resourceType: string;
  resourceName: string;
  account: string;
  extra?: string;
}): Promise<void> {
  try {
    const db = getTeamDb();
    if (!db) return;
    const channels = await db
      .select()
      .from(tNotifyChannels)
      .where(and(eq(tNotifyChannels.team_id, input.teamId), eq(tNotifyChannels.enabled, 1)));
    const text = `[AutoTest 团队] ${input.account} ${eventLabel(input.event)}「${input.resourceName}」(${input.resourceType})${input.extra ? ' — ' + input.extra : ''}`;
    await Promise.allSettled(channels.map((ch) => postWebhook(ch.type, ch.webhook_url, ch.secret || undefined, text)));
  } catch (err) {
    console.error('[team-notify] failed:', err);
  }
}

function eventLabel(e: string): string {
  switch (e) {
    case 'resource.create': return '创建了';
    case 'resource.update': return '更新了';
    case 'resource.delete': return '删除了';
    case 'import': return '导入了';
    default: return e;
  }
}

/**
 * SSRF guard (2026-08-25): webhook URL 可由团队 admin 配置 — 拒绝指向
 * 私网/环回/链路本地/元数据服务的地址, 防止借通知通道探测内网
 * (如 169.254.169.254 云元数据)。DNS 解析后的 IP 判定, 覆盖域名解析到
 * 内网 IP 的情况。
 */
async function webhookTargetAllowed(rawUrl: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
  // 纯 IPv6 字面量 URL 的 hostname 不带方括号
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  const { lookup } = await import('node:dns/promises');
  try {
    const addrs = await lookup(host, { all: true });
    for (const { address } of addrs) {
      if (
        address === '::1' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd') ||
        /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(address) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(address)
      ) {
        return false;
      }
    }
  } catch {
    return false; // DNS 解析失败 — 不放行
  }
  return true;
}

async function postWebhook(type: string, url: string, secret: string | undefined, text: string): Promise<void> {
  let body: string;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (type === 'feishu') {
    body = JSON.stringify({ msg_type: 'text', content: { text } });
  } else if (type === 'dingtalk') {
    body = JSON.stringify({ msgtype: 'text', text: { content: text } });
    if (secret) {
      const ts = Date.now();
      const sign = await hmacSign(secret, `${ts}\n${secret}`);
      url += `&timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
    }
  } else if (type === 'wecom') {
    body = JSON.stringify({ msgtype: 'text', text: { content: text } });
  } else if (type === 'slack') {
    body = JSON.stringify({ text });
  } else {
    body = JSON.stringify({ text });
  }
  if (!(await webhookTargetAllowed(url))) {
    console.error(`[team-notify] webhook ${type} blocked: target resolves to a private/reserved address`);
    return;
  }
  // redirect: 'manual' — 跟随重定向可被 302 引导到内网地址, 绕过上面的判定
  const res = await fetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(8000) });
  if (!res.ok) console.error(`[team-notify] webhook ${type} responded ${res.status}`);
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  return createHmac('sha256', secret).update(data, 'utf8').digest('base64');
}

export async function teamStats(teamId: number, projectId: number | null) {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用');
  const one = async (table: string): Promise<number> => {
    const r = await db.execute(
      `select count(*) as n from ${table} where team_id = ${Number(teamId)} and project_id = ${Number(projectId ?? 0)}`,
    );
    const rows = r[0] as unknown as Array<{ n: number | string }>;
    return Number(rows?.[0]?.n ?? 0);
  };
  return {
    apis: await one('t_apis'),
    scenarios: await one('t_scenarios'),
    scenarioSets: await one('t_scenario_sets'),
    webCases: await one('t_web_cases'),
    pcCases: await one('t_pc_cases'),
    mobileCases: await one('t_mobile_cases'),
    caseSets: (await one('t_case_sets_web')) + (await one('t_case_sets_pc')) + (await one('t_case_sets_mobile')),
    environments: await one('t_environments'),
    devices: await one('t_devices'),
    mocks: (await one('t_mocks_api')) + (await one('t_mocks_web')) + (await one('t_mocks_pc')) + (await one('t_mocks_mobile')),
  };
}
