import { mysqlTable, int, varchar, text, index, uniqueIndex } from 'drizzle-orm/mysql-core';

/**
 * Organization schema — center-server accounts + teams + projects.
 *
 * - `center_users` is a SEPARATE account store from the local `users` table:
 *   the center server is its own deployment with its own auth. Local users
 *   connect to a center by registering/logging-in there (ConnectTeamModal).
 * - Membership role lives at the team level; projects inherit team roles.
 *   role: owner > admin > editor > viewer (see db-team/util.ts ROLE_ORDER).
 * - All timestamps are app-generated "YYYY-MM-DD HH:MM:SS" strings in
 *   varchar(32) columns (no DB-time functions — timezone-safe by design).
 */

export const centerUsers = mysqlTable(
  'center_users',
  {
    id: int('id').autoincrement().primaryKey(),
    account: varchar('account', { length: 128 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    accountType: varchar('account_type', { length: 16 }).notNull().default('email'),
    nickname: varchar('nickname', { length: 128 }),
    avatar: varchar('avatar', { length: 512 }),
    email: varchar('email', { length: 128 }),
    phone: varchar('phone', { length: 32 }),
    // 1 = platform admin (bootstrap: the FIRST account registered on a fresh
    // deployment becomes platform admin). Controls team-creation policy etc.
    isPlatformAdmin: int('is_platform_admin').notNull().default(0),
    createdAt: varchar('created_at', { length: 32 }).notNull(),
    updatedAt: varchar('updated_at', { length: 32 }).notNull(),
  },
  (t) => [uniqueIndex('uk_center_users_account').on(t.account)],
);

export const teams = mysqlTable(
  'teams',
  {
    id: int('id').autoincrement().primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    description: varchar('description', { length: 512 }),
    createdBy: int('created_by').notNull(),
    createdAt: varchar('created_at', { length: 32 }).notNull(),
    updatedAt: varchar('updated_at', { length: 32 }).notNull(),
  },
  (t) => [uniqueIndex('uk_teams_name').on(t.name)],
);

export const teamMembers = mysqlTable(
  'team_members',
  {
    id: int('id').autoincrement().primaryKey(),
    teamId: int('team_id').notNull(),
    userId: int('user_id').notNull(),
    role: varchar('role', { length: 16 }).notNull().default('editor'),
    createdAt: varchar('created_at', { length: 32 }).notNull(),
  },
  (t) => [
    uniqueIndex('uk_team_members_team_user').on(t.teamId, t.userId),
    index('idx_team_members_user').on(t.userId),
  ],
);

export const projects = mysqlTable(
  'projects',
  {
    id: int('id').autoincrement().primaryKey(),
    teamId: int('team_id').notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    description: varchar('description', { length: 512 }),
    createdBy: int('created_by').notNull(),
    createdAt: varchar('created_at', { length: 32 }).notNull(),
    updatedAt: varchar('updated_at', { length: 32 }).notNull(),
  },
  (t) => [
    uniqueIndex('uk_projects_team_name').on(t.teamId, t.name),
    index('idx_projects_team').on(t.teamId),
  ],
);

/**
 * Team invite codes (2026-08-22): owner/admin generates a code anytime,
 * members redeem it to join the team - no admin-side account lookup needed.
 *
 * - code: unambiguous alphabet (no 0/O/1/I), format XXXX-XXXX-XXXX, unique.
 * - role: role granted on redemption (admin/editor/viewer, never owner).
 * - maxUses: 0 = unlimited; usedCount tracks redemptions.
 * - expiresAt: null = never expires (the default - invite links can live
 *   for months). Revoked = 1 disables a code without deleting history.
 */
export const teamInvites = mysqlTable(
  'team_invites',
  {
    id: int('id').autoincrement().primaryKey(),
    teamId: int('team_id').notNull(),
    code: varchar('code', { length: 32 }).notNull(),
    role: varchar('role', { length: 16 }).notNull().default('editor'),
    note: varchar('note', { length: 128 }),
    maxUses: int('max_uses').notNull().default(0),
    usedCount: int('used_count').notNull().default(0),
    expiresAt: varchar('expires_at', { length: 32 }),
    revoked: int('revoked').notNull().default(0),
    createdBy: int('created_by').notNull(),
    createdAt: varchar('created_at', { length: 32 }).notNull(),
  },
  (t) => [
    uniqueIndex('uk_team_invites_code').on(t.code),
    index('idx_team_invites_team').on(t.teamId),
  ],
);

/**
 * Center-account preferences (2026-08-25): per-user key-value store on the
 * center DB, mirroring the local SQLite user_preferences table. First key:
 * `lastTeamSelection` — the team/project the user last switched to, so any
 * device they log in on restores it (cross-device roaming; the localStorage
 * copy only remembers per-browser).
 */
export const centerUserPrefs = mysqlTable(
  'center_user_prefs',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id').notNull(),
    prefKey: varchar('pref_key', { length: 64 }).notNull(),
    // TiDB TEXT columns cannot have defaults — always written explicitly.
    prefValue: text('pref_value').notNull(),
    updatedAt: varchar('updated_at', { length: 32 }).notNull(),
  },
  (t) => [uniqueIndex('uk_center_user_prefs').on(t.userId, t.prefKey)],
);

export type CenterUserRow = typeof centerUsers.$inferSelect;
export type TeamRow = typeof teams.$inferSelect;
export type TeamMemberRow = typeof teamMembers.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type TeamInviteRow = typeof teamInvites.$inferSelect;
export type CenterUserPrefRow = typeof centerUserPrefs.$inferSelect;
