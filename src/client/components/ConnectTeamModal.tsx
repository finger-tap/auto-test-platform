import { useState, useRef, useEffect } from 'react';
import {
  normalizeCenterUrl,
  setTeamAuth,
  getTeamAuth,
  getLastCenterUrl,
  type TeamAuth,
} from '../utils/teamAuth';
import type { TeamCreatePolicy } from '../types/team';
import type { TeamPingResult, TeamUserInfo } from '../types/team';
import { is2xx } from '../utils/api';
import './ConnectTeamModal.css';

/**
 * Connect-team wizard:
 *   step 1 — enter the center server URL, probe GET /api/team/ping
 *   step 2 — login (or register) against that center directly
 * On success: store credentials (teamAuth:<centerUrl>) and hand the fresh
 * auth back to the caller (WorkspaceSwitcher switches the workspace).
 *
 * NOTE: requests here deliberately use raw fetch against the center URL —
 * the global apiFetch routing is not in team mode yet at this point.
 */

type PingState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; url: string; data: TeamPingResult }
  | { status: 'error'; message: string };

interface Props {
  onClose: () => void;
  onConnected: (auth: TeamAuth, centerUrl: string) => void;
  /** Pre-filled center URL (invite-link flow) - user can still edit. */
  initialUrl?: string;
}

export default function ConnectTeamModal({ onClose, onConnected, initialUrl }: Props) {
  const [urlInput, setUrlInput] = useState(() => {
    if (initialUrl) return initialUrl;
    // Prefill: last connected center > the site the app is served from
    // (single-deployment model: this origin IS the center - nobody types
    // an address anymore).
    return getLastCenterUrl() || window.location.origin;
  });
  const [ping, setPing] = useState<PingState>({ status: 'idle' });
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const probeCenter = async () => {
    const url = normalizeCenterUrl(urlInput);
    if (!url || !/^https?:\/\/.+/i.test(url)) {
      setPing({ status: 'error', message: '请输入有效的服务地址，例如 http://192.168.1.50:3000' });
      return;
    }
    setPing({ status: 'checking' });
    try {
      const res = await fetch(`${url}/api/team/ping`);
      const body = (await res.json().catch(() => null)) as
        | { code?: number; data?: TeamPingResult }
        | null;
      if (!res.ok || !body || !is2xx(body.code) || !body.data) {
        throw new Error('该地址不是有效的中心服务');
      }
      if (!body.data.teamDbConfigured || !body.data.teamReady) {
        setPing({ status: 'ok', url, data: body.data });
        setError('中心服务可达，但团队数据库未就绪（对方需配置 DB_URL）。你可以登录，团队功能暂不可用。');
        return;
      }
      setError(null);
      setPing({ status: 'ok', url, data: body.data });
    } catch (e) {
      setPing({
        status: 'error',
        message: e instanceof Error ? `无法连接：${e.message}` : '无法连接该地址',
      });
    }
  };

  const submit = async () => {
    if (ping.status !== 'ok') return;
    const url = ping.url;
    setSubmitting(true);
    setError(null);
    try {
      const path = tab === 'login' ? '/api/team/auth/login' : '/api/team/auth/register';
      const payload: Record<string, string> = { account, password };
      if (tab === 'register') payload.nickname = nickname;

      const res = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as
        | { code?: number; message?: string; data?: { token?: string; user?: TeamUserInfo; createPolicy?: TeamCreatePolicy } }
        | null;

      if (!res.ok || !body || !body.data?.token || !body.data.user) {
        throw new Error(body?.message || '操作失败');
      }
      const auth: TeamAuth = {
        token: body.data.token,
        user: body.data.user,
        createPolicy: body.data.createPolicy,
      };
      setTeamAuth(url, auth);
      onConnected(auth, url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const probeAgain = () => {
    setPing({ status: 'idle' });
    setError(null);
  };

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="modal modal-md connect-team-modal">
        <div className="modal-header">
          <div className="modal-title">连接团队服务</div>
          <button className="modal-close" onClick={onClose} title="关闭">×</button>
        </div>

        <div className="modal-body">
          {/* ── Step 1: center URL ── */}
          <div className="form-group">
            <label className="form-label">中心服务地址</label>
            <div className="ctm-url-row">
              <input
                className="form-input"
                placeholder="http://192.168.1.50:3000"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                disabled={ping.status === 'ok'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ping.status !== 'ok') void probeCenter();
                }}
              />
              {ping.status === 'ok' ? (
                <button className="btn btn-default" onClick={probeAgain}>
                  重填
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => void probeCenter()}
                  disabled={ping.status === 'checking' || !urlInput.trim()}
                >
                  {ping.status === 'checking' ? '探测中…' : '测试连接'}
                </button>
              )}
            </div>
            {ping.status === 'error' && <div className="form-error">{ping.message}</div>}
            {ping.status === 'ok' && (
              <div className="form-hint ctm-ok-hint">
                ✓ 服务可达{ping.data.dbOk ? ' · 团队数据库正常' : ''}
              </div>
            )}
          </div>

          {/* ── Step 2: auth ── */}
          {ping.status === 'ok' && (
            <>
              {/* resume an existing session if we already have one for this center */}
              <ResumeHint centerUrl={ping.url} onConnected={onConnected} />

              <div className="ctm-tabs">
                <button
                  className={`ctm-tab ${tab === 'login' ? 'active' : ''}`}
                  onClick={() => setTab('login')}
                >
                  登录
                </button>
                <button
                  className={`ctm-tab ${tab === 'register' ? 'active' : ''}`}
                  onClick={() => setTab('register')}
                >
                  注册新账号
                </button>
              </div>

              <div className="form-group">
                <label className="form-label">账号</label>
                <input
                  className="form-input"
                  placeholder="手机号 / 邮箱"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">密码</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder={tab === 'register' ? '至少 6 位' : '密码'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !submitting) void submit();
                  }}
                />
              </div>
              {tab === 'register' && (
                <div className="form-group">
                  <label className="form-label">昵称（可选）</label>
                  <input
                    className="form-input"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          {error && <div className="form-error ctm-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-default" onClick={onClose}>
            取消
          </button>
          {ping.status === 'ok' && (
            <button
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={submitting || !account.trim() || password.length < (tab === 'register' ? 6 : 1)}
            >
              {submitting ? '提交中…' : tab === 'login' ? '登录并连接' : '注册并连接'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** If credentials already exist for this center, offer one-click resume. */
function ResumeHint({
  centerUrl,
  onConnected,
}: {
  centerUrl: string;
  onConnected: (auth: TeamAuth, url: string) => void;
}) {
  const existing = getTeamAuth(centerUrl);
  if (!existing) return null;
  return (
    <div className="ctm-resume">
      <span>
        已有该服务的登录凭据（{existing.user.nickname || existing.user.account}）
      </span>
      <button className="btn btn-text" onClick={() => onConnected(existing, centerUrl)}>
        直接进入 →
      </button>
    </div>
  );
}
