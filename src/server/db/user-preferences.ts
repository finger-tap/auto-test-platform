import db from './index.js';

export interface UserPreference {
  id: number;
  user_id: number;
  test_type: string;
  environment_id: number | null;
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
