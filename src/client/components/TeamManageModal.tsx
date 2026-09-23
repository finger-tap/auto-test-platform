import { useEffect, useState, useCallback } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { apiFetch } from '../utils/api';
import { notification } from '../utils/notification';
import type { TeamMemberInfo, ProjectInfo, TeamInviteInfo } from '../types/team';
import { TEAM_ROLE_LABELS, INVITE_STATUS_LABELS, type TeamRole } from '../types/team';
import './TeamManageModal.css';
import { useModalKeyboard } from '../hooks/useModalKeyboard';

/**
 * Team management modal: members / invites / notify channels / audit log.
 * Opened from the workspace switcher (owner/admin operations inside).
 */

type Tab = 'members' | 'invites' | 'channels' | 'data' | 'audit';

interface Channel {
  id: number;
  name: string;
  type: string;
  webhook_url: string;
  events: string;
  enabled: number;
}

interface AuditRow {
  id: number;
  account: string;
  action: string;
  resource_type: string;
  resource_name: string | null;
  created_at: string;
}

interface Props {
  onClose: () => void;
  /** 2026-08-23: 数据页签的启动器 - 由 WorkspaceSwitcher 接管打开导入弹窗 */
  onOpenImport?: (mode: 'self' | 'pick-account') => void;
}

export default function TeamManageModal({ onClose, onOpenImport }: Props) {
  // Esc 关闭统一 (2026-08-27)
  useModalKeyboard(true, onClose);
  const { workspace, teams, projects, refreshTeams } = useWorkspace();
  // team-mode modal - centerUrl builds full invite links
  const centerUrl = workspace.mode === 'team' ? workspace.centerUrl : '';
  const [tab, setTab] = useState<Tab>('members');
  const [members, setMembers] = useState<TeamMemberInfo[]>([]);
  const [invites, setInvites] = useState<TeamInviteInfo[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [addAccount, setAddAccount] = useState('');
  const [addRole, setAddRole] = useState<TeamRole>('editor');
  const [invRole, setInvRole] = useState<TeamRole>('editor');
  const [invDays, setInvDays] = useState<string>('never');
  const [invUses, setInvUses] = useState<string>('0');
  const [invNote, setInvNote] = useState('');
  const [chName, setChName] = useState('');
  const [chType, setChType] = useState('feishu');
  const [chUrl, setChUrl] = useState('');

  if (workspace.mode !== 'team') return null;
  const teamId = workspace.teamId;
  const projectId = workspace.projectId ?? undefined;
  const myRole = teams.find((t) => t.id === teamId)?.role ?? 'viewer';
  const canAdmin = myRole === 'owner' || myRole === 'admin';

  const load = useCallback(async (t: Tab) => {
    setLoading(true);
    try {
      if (t === 'members') {
        const res = await apiFetch<{ members: TeamMemberInfo[] }>(`/team/teams/${teamId}/members`);
        setMembers(res.data?.members ?? []);
      } else if (t === 'invites') {
        const res = await apiFetch<{ invites: TeamInviteInfo[] }>(`/team/teams/${teamId}/invites`);
        setInvites(res.data?.invites ?? []);
      } else if (t === 'channels') {
        const res = await apiFetch<Channel[]>(`/team/teams/${teamId}/channels`);
        setChannels(res.data ?? []);
      } else {
        const res = await apiFetch<AuditRow[]>(`/team/teams/${teamId}/audit?limit=200${projectId ? `&projectId=${projectId}` : ''}`);
        setAudit(res.data ?? []);
      }
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, projectId]);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  const addMember = async () => {
    if (!addAccount.trim()) return;
    try {
      await apiFetch(`/team/teams/${teamId}/members`, {
        method: 'POST',
        body: JSON.stringify({ account: addAccount.trim(), role: addRole }),
      });
      notification.success('成员已添加');
      setAddAccount('');
      void load('members');
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '添加失败');
    }
  };

  const changeRole = async (userId: number, role: TeamRole) => {
    try {
      await apiFetch(`/team/teams/${teamId}/members/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      notification.success('角色已更新');
      void load('members');
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '更新失败');
    }
  };

  const removeMember = async (userId: number) => {
    if (!window.confirm('确认移除该成员？')) return;
    try {
      await apiFetch(`/team/teams/${teamId}/members/${userId}`, { method: 'DELETE' });
      notification.success('成员已移除');
      void load('members');
      void refreshTeams();
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '移除失败');
    }
  };

  // ── invites ──
  const createInvite = async () => {
    const days = invDays === 'never' ? null : Number(invDays);
    const uses = Number(invUses) || 0;
    try {
      const res = await apiFetch<{ invite: TeamInviteInfo }>(`/team/teams/${teamId}/invites`, {
        method: 'POST',
        body: JSON.stringify({ role: invRole, note: invNote.trim() || undefined, maxUses: uses, expiresInDays: days }),
      });
      const code = res.data?.invite?.code;
      notification.success(code ? `邀请码已生成：${code}（已复制）` : '邀请码已生成');
      if (code) void navigator.clipboard?.writeText(code).catch(() => undefined);
      setInvNote('');
      void load('invites');
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '生成失败');
    }
  };

  const revokeInvite = async (id: number, code: string) => {
    if (!window.confirm(`确认撤销邀请码 ${code}？撤销后无法再用它加入团队。`)) return;
    try {
      await apiFetch(`/team/teams/${teamId}/invites/${id}`, { method: 'DELETE' });
      notification.success('邀请码已撤销');
      void load('invites');
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '撤销失败');
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      notification.success('已复制邀请码');
    } catch {
      notification.warning('复制失败，请手动选择复制');
    }
  };

  /** Full invite link - carries the server address so members never type it. */
  const copyInviteLink = async (code: string) => {
    const link = `${centerUrl.replace(/\/+$/, '')}/join/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      notification.success('邀请链接已复制，发给同事即可一键加入');
    } catch {
      notification.warning('复制失败：' + link);
    }
  };

  const addChannel = async () => {
    if (!chName.trim() || !chUrl.trim()) {
      notification.warning('请填写名称和 Webhook 地址');
      return;
    }
    try {
      await apiFetch(`/team/teams/${teamId}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name: chName.trim(), type: chType, webhook_url: chUrl.trim() }),
      });
      notification.success('通知渠道已创建');
      setChName('');
      setChUrl('');
      void load('channels');
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '创建失败');
    }
  };

  const toggleChannel = async (ch: Channel) => {
    try {
      await apiFetch(`/team/teams/${teamId}/channels/${ch.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !ch.enabled }),
      });
      void load('channels');
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '更新失败');
    }
  };

  const deleteChannel = async (id: number) => {
    if (!window.confirm('确认删除该通知渠道？')) return;
    try {
      await apiFetch(`/team/teams/${teamId}/channels/${id}`, { method: 'DELETE' });
      void load('channels');
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const project: ProjectInfo | null = projects.find((p) => p.id === projectId) ?? null;

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg tmm-modal">
        <div className="modal-header">
          <div className="modal-title">团队管理 · {workspace.teamName}{project ? ` / ${project.name}` : ''}</div>
          <button className="modal-close" onClick={onClose} title="关闭">×</button>
        </div>

        <div className="tmm-tabs">
          {(['members', 'invites', 'channels', 'data', 'audit'] as Tab[]).map((t) => (
            <button key={t} className={`tmm-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'members' ? `成员（${members.length}）` : t === 'invites' ? '邀请码' : t === 'channels' ? '通知渠道' : t === 'data' ? '数据' : '操作审计'}
            </button>
          ))}
        </div>

        <div className="modal-body tmm-body">
          {loading && <div className="tmm-empty">加载中…</div>}

          {!loading && tab === 'members' && (
            <>
              {canAdmin && (
                <div className="tmm-add-row">
                  <input className="form-input" placeholder="对方中心账号（需已注册）" value={addAccount} onChange={(e) => setAddAccount(e.target.value)} />
                  <select className="form-select" style={{ width: 110 }} value={addRole} onChange={(e) => setAddRole(e.target.value as TeamRole)}>
                    <option value="admin">管理员</option>
                    <option value="editor">编辑者</option>
                    <option value="viewer">查看者</option>
                  </select>
                  <button className="btn btn-primary" onClick={() => void addMember()}>添加</button>
                </div>
              )}
              <table className="tmm-table">
                <thead>
                  <tr><th>成员</th><th>账号</th><th>角色</th><th>加入时间</th><th /></tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.userId}>
                      <td>{m.nickname || m.account}</td>
                      <td className="tmm-muted">{m.account}</td>
                      <td>
                        {m.role === 'owner' ? (
                          <span className="tmm-role">{TEAM_ROLE_LABELS.owner}</span>
                        ) : canAdmin ? (
                          <select className="form-select" style={{ width: 100 }} value={m.role} onChange={(e) => void changeRole(m.userId, e.target.value as TeamRole)}>
                            <option value="admin">管理员</option>
                            <option value="editor">编辑者</option>
                            <option value="viewer">查看者</option>
                          </select>
                        ) : (
                          <span className="tmm-role">{TEAM_ROLE_LABELS[m.role]}</span>
                        )}
                      </td>
                      <td className="tmm-muted">{m.joinedAt?.slice(0, 16)}</td>
                      <td>
                        {canAdmin && m.role !== 'owner' && (
                          <button className="btn btn-default btn-sm" onClick={() => void removeMember(m.userId)}>移除</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {!loading && tab === 'invites' && (
            <>
              {canAdmin && (
                <div className="tmm-invite-form">
                  <div className="tmm-add-row">
                    <select className="form-select" style={{ width: 100 }} value={invRole} onChange={(e) => setInvRole(e.target.value as TeamRole)} title="加入后获得的角色">
                      <option value="admin">管理员</option>
                      <option value="editor">编辑者</option>
                      <option value="viewer">查看者</option>
                    </select>
                    <select className="form-select" style={{ width: 110 }} value={invDays} onChange={(e) => setInvDays(e.target.value)} title="有效期">
                      <option value="never">永久有效</option>
                      <option value="7">7 天有效</option>
                      <option value="30">30 天有效</option>
                      <option value="90">90 天有效</option>
                    </select>
                    <select className="form-select" style={{ width: 110 }} value={invUses} onChange={(e) => setInvUses(e.target.value)} title="使用次数">
                      <option value="0">不限次数</option>
                      <option value="1">限 1 次</option>
                      <option value="5">限 5 次</option>
                      <option value="10">限 10 次</option>
                    </select>
                    <button className="btn btn-primary" onClick={() => void createInvite()}>生成邀请码</button>
                  </div>
                  <input className="form-input" placeholder="备注（可选，例如：QA 二组 / 张三的同事）" value={invNote} onChange={(e) => setInvNote(e.target.value)} />
                </div>
              )}
              {invites.length === 0 ? (
                <div className="tmm-empty">
                  暂无邀请码 - 生成后点「链接」复制完整邀请链接发给同事，对方打开/粘贴即可加入（无需知道服务器地址）；
                  邀请码永久保留在这里，随时查看、复制或撤销
                </div>
              ) : (
                <table className="tmm-table">
                  <thead>
                    <tr><th>邀请码</th><th>角色</th><th>备注</th><th>有效期</th><th>已用</th><th>状态</th><th>创建时间</th><th /></tr>
                  </thead>
                  <tbody>
                    {invites.map((inv) => (
                      <tr key={inv.id} className={inv.status !== 'valid' ? 'tmm-row-dim' : ''}>
                        <td>
                          <button className="tmm-code" title="点击复制" onClick={() => void copyCode(inv.code)}>
                            {inv.code}
                          </button>
                        </td>
                        <td>{TEAM_ROLE_LABELS[inv.role]}</td>
                        <td className="tmm-muted">{inv.note || '-'}</td>
                        <td className="tmm-muted">{inv.expiresAt ? inv.expiresAt.slice(0, 10) : '永久'}</td>
                        <td className="tmm-muted">{inv.maxUses > 0 ? `${inv.usedCount}/${inv.maxUses}` : `${inv.usedCount}/∞`}</td>
                        <td>
                          <span className={`tmm-inv-status tmm-inv-${inv.status}`}>{INVITE_STATUS_LABELS[inv.status]}</span>
                        </td>
                        <td className="tmm-muted">{inv.createdAt?.slice(0, 16)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {inv.status === 'valid' && (
                              <button className="btn btn-default btn-sm" title="复制含服务器地址的完整链接" onClick={() => void copyInviteLink(inv.code)}>链接</button>
                            )}
                            {canAdmin && inv.status === 'valid' && (
                              <button className="btn btn-default btn-sm" onClick={() => void revokeInvite(inv.id, inv.code)}>撤销</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {!loading && tab === 'channels' && (
            <>
              {canAdmin && (
                <div className="tmm-add-row">
                  <input className="form-input" style={{ width: 130 }} placeholder="渠道名称" value={chName} onChange={(e) => setChName(e.target.value)} />
                  <select className="form-select" style={{ width: 100 }} value={chType} onChange={(e) => setChType(e.target.value)}>
                    <option value="feishu">飞书</option>
                    <option value="dingtalk">钉钉</option>
                    <option value="wecom">企业微信</option>
                    <option value="slack">Slack</option>
                    <option value="custom">自定义</option>
                  </select>
                  <input className="form-input" placeholder="Webhook URL" value={chUrl} onChange={(e) => setChUrl(e.target.value)} />
                  <button className="btn btn-primary" onClick={() => void addChannel()}>创建</button>
                </div>
              )}
              {channels.length === 0 ? (
                <div className="tmm-empty">暂无通知渠道 — 创建后，资源变更会自动推送到群机器人</div>
              ) : (
                <table className="tmm-table">
                  <thead>
                    <tr><th>名称</th><th>类型</th><th>Webhook</th><th>状态</th><th /></tr>
                  </thead>
                  <tbody>
                    {channels.map((ch) => (
                      <tr key={ch.id}>
                        <td>{ch.name}</td>
                        <td>{ch.type}</td>
                        <td className="tmm-muted tmm-ellipsis">{ch.webhook_url}</td>
                        <td>
                          {canAdmin ? (
                            <button className="btn btn-default btn-sm" onClick={() => void toggleChannel(ch)}>
                              {ch.enabled ? '✅ 启用' : '⏸ 停用'}
                            </button>
                          ) : (ch.enabled ? '启用' : '停用')}
                        </td>
                        <td>
                          {canAdmin && <button className="btn btn-default btn-sm" onClick={() => void deleteChannel(ch.id)}>删除</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {!loading && tab === 'data' && (
            <div className="tmm-data-tab">
              <div className="tmm-data-card" onClick={() => onOpenImport?.('self')}>
                <div className="tmm-data-title">⬆ 导入本机资源到当前项目</div>
                <div className="tmm-data-desc">
                  把<b>你自己</b>个人空间里的用例 / 场景 / 环境 / Mock 导入当前团队项目（自动带上依赖，冲突可逐项处理）。
                  {!workspace.projectId && <span className="tmm-data-warn">（请先在左上角切换器里选中一个项目）</span>}
                </div>
              </div>
              <div className="tmm-data-card" onClick={() => onOpenImport?.('pick-account')}>
                <div className="tmm-data-title">🔄 同步本地账号数据到团队</div>
                <div className="tmm-data-desc">
                  选择<b>任意本地账号</b>（如同事的个人空间），把它的数据同步进团队项目--适合管理员把大家的个人数据集中到团队。
                  {!workspace.projectId && <span className="tmm-data-warn">（请先在左上角切换器里选中一个项目）</span>}
                </div>
              </div>
              <div className="tmm-data-hint">
                同步走服务端完成（带版本备份与操作审计）；同名资源可选择跳过 / 覆盖 / 保留副本。
              </div>
            </div>
          )}

          {!loading && tab === 'audit' && (
            audit.length === 0 ? (
              <div className="tmm-empty">暂无操作记录</div>
            ) : (
              <table className="tmm-table">
                <thead>
                  <tr><th>时间</th><th>成员</th><th>操作</th><th>资源</th></tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td className="tmm-muted">{a.created_at?.slice(5, 16)}</td>
                      <td>{a.account}</td>
                      <td>
                        <span className={`tmm-action tmm-action-${a.action}`}>
                          {{ create: '创建', update: '更新', delete: '删除', import: '导入', rollback: '回滚' }[a.action] ?? a.action}
                        </span>
                      </td>
                      <td>{a.resource_name || a.resource_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-default" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
