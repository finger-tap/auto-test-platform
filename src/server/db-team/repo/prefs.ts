import { and, eq } from 'drizzle-orm';
import { getTeamDb } from '../client.js';
import { centerUserPrefs } from '../schema/org.js';
import { nowSql, TeamApiError } from '../util.js';

/**
 * Center-account preferences (2026-08-25) — per-user key-value store.
 *
 * Currently holds `lastTeamSelection` (JSON: teamId/teamName/projectId/
 * projectName) so the login flow on ANY device restores the team/project
 * the user last worked in. Mirrors the local SQLite user_preferences table.
 */

/** Keys the API layer is allowed to read/write (whitelist, not a free store).
 *  NOTE: these match the URL path segment (/team/auth/prefs/<key>) — kebab-case. */
export const PREF_KEYS = ['last-team'] as const;
export type PrefKey = (typeof PREF_KEYS)[number];

export function isPrefKey(k: string): k is PrefKey {
  return (PREF_KEYS as readonly string[]).includes(k);
}

export async function getPref(userId: number, key: PrefKey): Promise<string | null> {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  const rows = await db
    .select({ value: centerUserPrefs.prefValue })
    .from(centerUserPrefs)
    .where(and(eq(centerUserPrefs.userId, userId), eq(centerUserPrefs.prefKey, key)))
    .limit(1);
  return rows[0]?.value ?? null;
}

/** Upsert — INSERT ... ON DUPLICATE KEY UPDATE on the (user_id, pref_key) unique key. */
export async function setPref(userId: number, key: PrefKey, value: string): Promise<void> {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用（中心数据库未配置）');
  await db
    .insert(centerUserPrefs)
    .values({ userId, prefKey: key, prefValue: value, updatedAt: nowSql() })
    .onDuplicateKeyUpdate({
      set: { prefValue: value, updatedAt: nowSql() },
    });
}
