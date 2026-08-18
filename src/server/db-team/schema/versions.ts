import { mysqlTable, int, varchar, mediumtext, index, uniqueIndex } from 'drizzle-orm/mysql-core';

/**
 * Versioning & presence schema.
 *
 * resource_versions — append-only snapshots for every team resource update:
 *  - written on each successful save (content-hash deduped: unchanged content
 *    does NOT burn a version number)
 *  - rollback = create a NEW version from an old snapshot (history is never
 *    mutated or deleted by users)
 *  - retention: keep the latest N (default 50) per resource, compact older
 *    ones in a background cron (mirrors report-cleanup pattern)
 *
 * presence — "who is editing" hint. Soft signal only (30s heartbeat expiry);
 * the hard guarantee against lost updates is the optimistic-lock `version`
 * column on business tables, not this table.
 */

export const resourceVersions = mysqlTable(
  'resource_versions',
  {
    id: int('id').autoincrement().primaryKey(),
    resourceType: varchar('resource_type', { length: 64 }).notNull(),
    resourceId: int('resource_id').notNull(),
    teamId: int('team_id').notNull(),
    projectId: int('project_id'),
    version: int('version').notNull(),
    /** Full JSON snapshot of the resource row at this version. mediumtext (16MB) — scenario/case bodies can be large. */
    snapshot: mediumtext('snapshot').notNull(),
    /** sha256 of canonicalized content — dedup + conflict pre-check. */
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    changeSummary: varchar('change_summary', { length: 512 }),
    /** optional origin note, e.g. "imported from local@dinghao" */
    origin: varchar('origin', { length: 128 }),
    changedBy: int('changed_by').notNull(),
    createdAt: varchar('created_at', { length: 32 }).notNull(),
  },
  (t) => [
    uniqueIndex('uk_resource_versions_rid').on(t.resourceType, t.resourceId, t.version),
    index('idx_resource_versions_team_project').on(t.teamId, t.projectId),
    index('idx_resource_versions_changed_by').on(t.changedBy),
  ],
);

export const presence = mysqlTable(
  'presence',
  {
    id: int('id').autoincrement().primaryKey(),
    resourceType: varchar('resource_type', { length: 64 }).notNull(),
    resourceId: int('resource_id').notNull(),
    teamId: int('team_id').notNull(),
    userId: int('user_id').notNull(),
    nickname: varchar('nickname', { length: 128 }),
    /** heartbeat timestamp; rows older than PRESENCE_TTL (30s) are considered gone */
    lastSeenAt: varchar('last_seen_at', { length: 32 }).notNull(),
  },
  (t) => [
    uniqueIndex('uk_presence_resource_user').on(t.resourceType, t.resourceId, t.userId),
    index('idx_presence_resource').on(t.resourceType, t.resourceId),
  ],
);

export const PRESENCE_TTL_SECONDS = 30;

export type ResourceVersionRow = typeof resourceVersions.$inferSelect;
export type PresenceRow = typeof presence.$inferSelect;
