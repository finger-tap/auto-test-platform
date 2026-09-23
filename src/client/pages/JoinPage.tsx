import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ConnectTeamModal from '../components/ConnectTeamModal';
import RedeemInviteModal from '../components/RedeemInviteModal';
import { getTeamAuth, setLastCenterUrl, normalizeCenterUrl } from '../utils/teamAuth';
import { notification } from '../utils/notification';
import { getToken } from '../utils/api';
import { useWorkspace } from '../contexts/WorkspaceContext';
import type { TeamSummary } from '../types/team';
import './JoinPage.css';

/**
 * /join/:code - invite link landing page (2026-08-22).
 *
 * The admin shares `http://server/join/CODE`; a colleague clicks it:
 *   1. not locally logged in  -> bounce to /login, come back afterwards
 *   2. no center credentials  -> ConnectTeamModal (URL prefilled = this
 *                                origin, register/login) -> auto redeem
 *   3. credentials exist      -> redeem immediately -> enter the team
 */

export default function JoinPage() {
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { switchToTeam, refreshTeams } = useWorkspace();
  const [phase, setPhase] = useState<'check' | 'connect' | 'redeem'>('check');
  const [centerUrl, setCenterUrl] = useState('');
  const bare = code.trim().toUpperCase();

  useEffect(() => {
    if (!/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/.test(bare)) {
      notification.error('邀请链接格式不正确');
      navigate('/', { replace: true });
      return;
    }
    // Not logged into THIS instance at all -> login first, come back.
    if (!getToken()) {
      navigate('/login', { state: { from: `/join/${bare}` }, replace: true });
      return;
    }
    const origin = normalizeCenterUrl(window.location.origin);
    setCenterUrl(origin);
    setPhase(getTeamAuth(origin) ? 'redeem' : 'connect');
  }, [bare, navigate]);

  const handleConnected = (_auth: unknown, url: string) => {
    setLastCenterUrl(url);
    setCenterUrl(url);
    setPhase('redeem');
  };

  const handleJoined = async (team: TeamSummary) => {
    await refreshTeams();
    switchToTeam(centerUrl, team, null);
    notification.success(`已进入团队「${team.name}」`);
    navigate('/', { replace: true });
  };

  if (phase === 'connect') {
    return (
      <ConnectTeamModal
        initialUrl={centerUrl || window.location.origin}
        onClose={() => navigate('/', { replace: true })}
        onConnected={handleConnected}
      />
    );
  }

  if (phase === 'redeem') {
    return (
      <RedeemInviteModal
        centerUrl={centerUrl}
        initialCode={bare}
        onClose={() => navigate('/', { replace: true })}
        onJoined={(t) => void handleJoined(t)}
        onNeedConnect={(url) => { setCenterUrl(url); setPhase('connect'); }}
      />
    );
  }

  return null;
}
