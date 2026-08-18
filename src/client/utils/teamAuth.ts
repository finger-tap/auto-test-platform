import type { TeamUserInfo } from '../types/team';

/**
 * Center-server credentials, stored per center URL so a browser can hold
 * sessions to multiple centers (and never collide with the local-instance
 * token stored under the plain `token` key).
 */

export interface TeamAuth {
  token: string;
  user: TeamUserInfo;
}

function keyFor(centerUrl: string): string {
  return `teamAuth:${centerUrl.replace(/\/+$/, '')}`;
}

export function normalizeCenterUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

export function getTeamAuth(centerUrl: string): TeamAuth | null {
  const raw = localStorage.getItem(keyFor(centerUrl));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TeamAuth;
    if (!parsed.token || !parsed.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setTeamAuth(centerUrl: string, auth: TeamAuth): void {
  localStorage.setItem(keyFor(centerUrl), JSON.stringify(auth));
}

export function removeTeamAuth(centerUrl: string): void {
  localStorage.removeItem(keyFor(centerUrl));
}

/** Last successfully connected center URL — lets the switcher enter a team right after connecting (before switching workspace). */
const LAST_CENTER_KEY = 'teamLastCenterUrl';

export function setLastCenterUrl(url: string): void {
  localStorage.setItem(LAST_CENTER_KEY, url);
}

export function getLastCenterUrl(): string | null {
  return localStorage.getItem(LAST_CENTER_KEY);
}

/** All center URLs this browser has credentials for (for UI "recent centers"). */
export function listKnownCenters(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('teamAuth:')) out.push(k.slice('teamAuth:'.length));
  }
  return out;
}
