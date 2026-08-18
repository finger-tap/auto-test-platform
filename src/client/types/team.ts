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
  createdAt: string;
  updatedAt: string;
}

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

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  owner: '所有者',
  admin: '管理员',
  editor: '编辑者',
  viewer: '查看者',
};
