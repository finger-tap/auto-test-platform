import { mysqlTable, int, varchar, index, uniqueIndex } from 'drizzle-orm/mysql-core';

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

export type CenterUserRow = typeof centerUsers.$inferSelect;
export type TeamRow = typeof teams.$inferSelect;
export type TeamMemberRow = typeof teamMembers.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
