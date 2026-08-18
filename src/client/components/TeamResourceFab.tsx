import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { apiFetch } from '../utils/api';
import { notification } from '../utils/notification';
import type { TeamUserInfo } from '../types/team';
import './TeamResourceFab.css';

/**
 * Floating team tool for detail pages (team mode only):
 *   👥 presence — who else is viewing this resource (30s heartbeat)
 *   🕘 versions — version history + one-click rollback
 *
 * Route-based: extracts the trailing numeric id and maps the path prefix to
 * a resource type — no per-page wiring needed.
 */

const TYPE_BY_PREFIX: Array<[RegExp, string]> = [
  [/^\/api-test\/apis/, 'api'],
  [/^\/api-test\/scenarios(?!-sets)/, 'scenario'],
  [/^\/api-test\/scenario-sets/, 'scenario_set'],
  [/^\/web-test\/cases/, 'web_case'],
  [/^\/pc-test\/cases/, 'pc_case'],
  [/^\/mobile-test\/tests/, 'mobile_case'],
  [/^\/web-test\/case-sets/, 'case_set_web'],
  [/^\/pc-test\/case-sets/, 'case_set_pc'],
  [/^\/mobile-test\/case-sets/, 'case_set_mobile'],
  [/^\/api-test\/mocks/, 'mock_api'],
  [/^\/web-test\/mocks/, 'mock_web'],
  [/^\/pc-test\/mocks/, 'mock_pc'],
  [/^\/mobile-test\/mocks/, 'mock_mobile'],
  [/^\/.*\/environments/, 'environment'],
];

interface VersionRow {
  version: number;
  changeSummary: string | null;
  origin: string | null;
  changedBy: number;
  createdAt: string;
}

interface PresenceRow {
  userId: number;
  nickname: string | null;
  lastSeenAt: string;
}

export default function TeamResourceFab() {
  const { workspace } = useWorkspace();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'presence' | 'versions'>('presence');
  const [present, setPresent] = useState<PresenceRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [rolling, setRolling] = useState<number | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isTeam = workspace.mode === 'team';
  const idMatch = location.pathname.match(/\/(\d+)(?:\/|$)/);
  const resourceId = idMatch ? Number(idMatch[1]) : null;
  const resourceType = TYPE_BY_PREFIX.find(([re]) => re.test(location.pathname))?.[1] ?? null;
  const active = isTeam && resourceId && resourceType;
  const teamUser = isTeam ? (JSON.parse(localStorage.getItem(`teamAuth:${workspace.centerUrl}`) || 'null') as { user: TeamUserInfo } | null)?.user : null;

  // heartbeat + presence poll while a detail resource is open
  useEffect(() => {
    if (!active || !workspace || workspace.mode !== 'team') {
      setPresent([]);
      return;
    }
    const ws = workspace;
    const beat = async () => {
      try {
        await apiFetch('/team/presence', {
          method: 'POST',
          body: JSON.stringify({ resourceType, resourceId, teamId: ws.teamId }),
        });
        const res = await apiFetch<PresenceRow[]>(`/team/presence?resourceType=${resourceType}&resourceId=${resourceId}&teamId=${ws.teamId}`);
        setPresent(res.data ?? []);
      } catch { /* silent */ }
    };
    void beat();
    heartbeatRef.current = setInterval(beat, 15_000);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active ? resourceType : '', active ? resourceId : 0, isTeam ? workspace.teamId : 0]);

  const loadVersions = async () => {
    if (!active) return;
    try {
      const res = await apiFetch<VersionRow[]>(`/${apiPathFor(resourceType!)}/${resourceId}/versions`);
      setVersions(res.data ?? []);
    } catch {
      setVersions([]);
    }
  };

  const openPanel = (t: 'presence' | 'versions') => {
    setTab(t);
    setOpen(true);
    if (t === 'versions') void loadVersions();
  };

  const rollback = async (version: number) => {
    if (!active || rolling !== null) return;
    setRolling(version);
    try {
      await apiFetch(`/${apiPathFor(resourceType!)}/${resourceId}/rollback`, {
        method: 'POST',
        body: JSON.stringify({ version }),
      });
      notification.success(`已回滚到 v${version}，页面即将刷新`);
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '回滚失败');
      setRolling(null);
    }
  };

  if (!active) return null;

  const others = present.filter((p) => !teamUser || p.nickname !== teamUser.account);

  return (
    <div className="trfab">
      <div className="trfab-dock">
        {others.length > 0 && (
          <button className="trfab-btn trfab-presence" title={`${others.map((o) => o.nickname || '成员').join('、')} 正在查看`} onClick={() => openPanel('presence')}>
            👥{others.length}
          </button>
        )}
        <button className="trfab-btn" title="版本历史" onClick={() => openPanel('versions')}>
          🕘
        </button>
      </div>

      {open && (
        <div className="trfab-panel">
          <div className="trfab-panel-head">
            <div className="trfab-tabs">
              <button className={`trfab-tab ${tab === 'presence' ? 'active' : ''}`} onClick={() => setTab('presence')}>
                在线（{others.length}）
              </button>
              <button className={`trfab-tab ${tab === 'versions' ? 'active' : ''}`} onClick={() => { setTab('versions'); void loadVersions(); }}>
                版本
              </button>
            </div>
            <button className="modal-close" onClick={() => setOpen(false)} title="关闭">×</button>
          </div>
          <div className="trfab-panel-body">
            {tab === 'presence' && (
              others.length === 0 ? (
                <div className="trfab-empty">当前没有其他成员在查看</div>
              ) : (
                others.map((o) => (
                  <div key={o.userId} className="trfab-row">
                    <span className="trfab-dot" />
                    <span>{o.nickname || `用户 ${o.userId}`}</span>
                    <span className="trfab-hint">正在查看</span>
                  </div>
                ))
              )
            )}
            {tab === 'versions' && (
              versions.length === 0 ? (
                <div className="trfab-empty">暂无历史版本</div>
              ) : (
                versions.map((v) => (
                  <div key={v.version} className="trfab-row">
                    <span className="trfab-ver">v{v.version}</span>
                    <span className="trfab-summary">{v.changeSummary || v.origin || '保存'}</span>
                    <span className="trfab-hint">{v.createdAt}</span>
                    <button
                      className="btn btn-default btn-sm"
                      disabled={rolling !== null}
                      onClick={() => void rollback(v.version)}
                      title="用该版本内容创建新版本"
                    >
                      {rolling === v.version ? '回滚中…' : '回滚'}
                    </button>
                  </div>
                ))
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function apiPathFor(type: string): string {
  switch (type) {
    case 'api': return 'apis';
    case 'scenario': return 'scenarios';
    case 'scenario_set': return 'scenario-sets';
    case 'web_case': return 'web-cases';
    case 'pc_case': return 'pc-cases';
    case 'mobile_case': return 'mobile-tests';
    case 'case_set_web': return 'case-sets-web';
    case 'case_set_pc': return 'case-sets-pc';
    case 'case_set_mobile': return 'case-sets-mobile';
    case 'environment': return 'environments';
    case 'mock_api': return 'mocks-api';
    case 'mock_web': return 'mocks-web';
    case 'mock_pc': return 'mocks-pc';
    case 'mock_mobile': return 'mocks-mobile';
    default: return '';
  }
}
