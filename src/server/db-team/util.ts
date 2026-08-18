/**
 * Team (center-server) shared utilities.
 *
 * Time format: application-generated "YYYY-MM-DD HH:MM:SS" strings, stored in
 * varchar(32) columns. This matches the existing SQLite TEXT timestamps so the
 * frontend datetime.ts formatter works unchanged, and avoids DB timezone
 * pitfalls entirely (TiDB/MySQL timestamp columns are timezone-sensitive).
 */

export function nowSql(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export type TeamRole = 'owner' | 'admin' | 'editor' | 'viewer';

export const TEAM_ROLES: TeamRole[] = ['owner', 'admin', 'editor', 'viewer'];

export const ROLE_ORDER: Record<TeamRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

export function isTeamRole(v: unknown): v is TeamRole {
  return typeof v === 'string' && (TEAM_ROLES as string[]).includes(v);
}

/** True when `role` satisfies at least the `min` privilege level. */
export function hasRole(role: string | null | undefined, min: TeamRole): boolean {
  if (!role || !(role in ROLE_ORDER)) return false;
  return ROLE_ORDER[role as TeamRole] >= ROLE_ORDER[min];
}

/**
 * Domain error carrying an HTTP status + business code, thrown by the repo
 * layer and translated to a `{ code, message }` JSON response by the route
 * layer's asyncHandler wrapper. Keeps db-team free of express imports.
 */
export class TeamApiError extends Error {
  status: number;
  code: number;

  constructor(status: number, message: string, code?: number) {
    super(message);
    this.name = 'TeamApiError';
    this.status = status;
    this.code = code ?? status;
  }
}
