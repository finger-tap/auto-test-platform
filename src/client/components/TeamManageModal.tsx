import { useEffect, useState, useCallback } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { apiFetch } from '../utils/api';
import { notification } from '../utils/notification';
import type { TeamMemberInfo, ProjectInfo } from '../types/team';
import { TEAM_ROLE_LABELS, type TeamRole } from '../types/team';
import './TeamManageModal.css';

/**
 * Team management modal: members / notify channels / audit log.
 * Opened from the workspace switcher (owner/admin operations inside).
 */

type Tab = 'members' | 'channels' | 'audit';

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
}

export default function TeamManageModal({ onClose }: Props) {
  const { workspace, teams, projects, refreshTeams } = useWorkspace();
  const [tab, setTab] = useState<Tab>('members');
  const [members, setMembers] = useState<TeamMemberInfo[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [addAccount, setAddAccount] = useState('');
  const [addRole, setAddRole] = useState<TeamRole>('editor');
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
          {(['members', 'channels', 'audit'] as Tab[]).map((t) => (
            <button key={t} className={`tmm-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'members' ? `成员（${members.length}）` : t === 'channels' ? '通知渠道' : '操作审计'}
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
