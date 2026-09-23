import { useState } from 'react';
import { apiFetchCenter } from '../utils/api';
import { notification } from '../utils/notification';
import { normalizeCenterUrl } from '../utils/teamAuth';
import type { TeamSummary } from '../types/team';
import './RedeemInviteModal.css';
import { useModalKeyboard } from '../hooks/useModalKeyboard';

/**
 * Redeem an invite code to join a team (2026-08-22).
 *
 * Input accepts BOTH forms:
 *   - bare code    7K2M-QX9D-PL4T        (center = current/last connection)
 *   - invite link  http://host:3001/join/7K2M-QX9D-PL4T
 *                  (center parsed from the link - the admin's "configured
 *                   backend address" travels WITH the invite, so members
 *                   never type a server address)
 */

const LINK_RE = /^(https?:\/\/[^/]+)\/join\/([A-Z2-9]{4}(?:-[A-Z2-9]{4}){2})$/i;

interface Props {
  centerUrl: string;
  onClose: () => void;
  onJoined: (team: TeamSummary) => void;
  /** When the link points at a center we have no credentials for yet. */
  onNeedConnect: (centerUrl: string, code: string) => void;
  initialCode?: string;
}

export default function RedeemInviteModal({ centerUrl, onClose, onJoined, onNeedConnect, initialCode }: Props) {
  // Esc 关闭统一 (2026-08-27)
  useModalKeyboard(true, onClose);
  const [code, setCode] = useState(initialCode ?? '');
  const [submitting, setSubmitting] = useState(false);

  const redeem = async () => {
    const raw = code.trim().toUpperCase();
    if (!raw) return;

    // Resolve target center + bare code from what the user pasted.
    let target = normalizeCenterUrl(centerUrl);
    let bare = raw;
    const m = raw.match(LINK_RE);
    if (m) {
      target = normalizeCenterUrl(m[1]);
      bare = m[2];
    }

    setSubmitting(true);
    try {
      const res = await apiFetchCenter<{
        team: { id: number; name: string; description: string | null };
        role: TeamSummary['role'];
        memberCount: number;
      }>(target, '/team/invites/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: bare }),
      });
      const d = res.data;
      if (d) {
        notification.success(`已加入团队「${d.team.name}」（${d.role === 'admin' ? '管理员' : d.role === 'editor' ? '编辑者' : '查看者'}）`);
        onJoined({
          id: d.team.id,
          name: d.team.name,
          description: d.team.description,
          role: d.role,
          memberCount: d.memberCount,
          projectCount: 0,
          createdAt: '',
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '加入失败';
      // Link pointed at a center we are not logged into yet -> hand over to
      // the connect wizard, then come back with the code pre-filled.
      if (m && msg.includes('团队登录已过期')) {
        onNeedConnect(target, bare);
        return;
      }
      notification.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal rim-modal">
        <div className="modal-header">
          <div className="modal-title">🎟 使用邀请码加入团队</div>
          <button className="modal-close" onClick={onClose} title="关闭">×</button>
        </div>
        <div className="modal-body rim-body">
          <div className="rim-hint">
            粘贴管理员分享的<b>邀请码</b>或<b>完整邀请链接</b>（链接自带服务器地址，直接粘贴即可）
          </div>
          <input
            className="form-input rim-code-input"
            placeholder="XXXX-XXXX-XXXX 或 http://服务器地址/join/XXXX-XXXX-XXXX"
            value={code}
            autoFocus
            spellCheck={false}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void redeem(); }}
          />
        </div>
        <div className="modal-footer">
          <button className="btn btn-default" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={submitting || !code.trim()} onClick={() => void redeem()}>
            {submitting ? '加入中…' : '加入团队'}
          </button>
        </div>
      </div>
    </div>
  );
}
