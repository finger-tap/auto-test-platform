import db from './index.js';

export interface UserPreference {
  id: number;
  user_id: number;
  test_type: string;
  environment_id: number | null;
  value: string | null;
  updated_at: string;
}

export function getPreference(userId: number, testType: string): UserPreference | null {
  return db.prepare(
    'SELECT * FROM user_preferences WHERE user_id = ? AND test_type = ?'
  ).get(userId, testType) as UserPreference | null;
}

export function setPreference(userId: number, testType: string, environmentId: number | null): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_preferences (user_id, test_type, environment_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, test_type) DO UPDATE SET environment_id = excluded.environment_id, updated_at = excluded.updated_at
  `).run(userId, testType, environmentId, now);
}

/** 读取全局用户设置（test_type 为固定 key，如 'theme'） */
export function getUserSetting(userId: number, key: string): string | null {
  const row = db.prepare(
    'SELECT value FROM user_preferences WHERE user_id = ? AND test_type = ?'
  ).get(userId, key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

/** 写入全局用户设置 */
export function setUserSetting(userId: number, key: string, value: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_preferences (user_id, test_type, value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, test_type) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(userId, key, value, now);
}
