/**
 * Team collaboration frontend types (center-server domain).
 * Mirrors src/server/db-team schema & repo shapes.
 */

export type TeamRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface TeamUserInfo {
  id: number;
  account: string;
  accountType: string;
  nickname: string | null;
  avatar: string | null;
  email: string | null;
  phone: string | null;
  /** 1 = platform admin of the center deployment (first registered account). */
  isPlatformAdmin: number;
  createdAt: string;
  updatedAt: string;
}

/** Who may create teams on this center: 'admin' = platform admin only (default), 'self' = anyone. */
export type TeamCreatePolicy = 'admin' | 'self';

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

export interface TeamPingResult {
  server: string;
  teamDbConfigured: boolean;
  teamReady: boolean;
  dbOk: boolean;
}

/** Team invite code (owner/admin view - full code visible for re-sharing). */
export interface TeamInviteInfo {
  id: number;
  code: string;
  role: TeamRole;
  note: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  revoked: boolean;
  createdBy: number;
  createdAt: string;
  status: 'valid' | 'revoked' | 'expired' | 'exhausted';
}

export const INVITE_STATUS_LABELS: Record<TeamInviteInfo['status'], string> = {
  valid: '有效',
  revoked: '已撤销',
  expired: '已过期',
  exhausted: '已用完',
};

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  owner: '所有者',
  admin: '管理员',
  editor: '编辑者',
  viewer: '查看者',
};
