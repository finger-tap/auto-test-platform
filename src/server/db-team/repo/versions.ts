import { and, eq, desc, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getTeamDb } from '../client.js';
import { resourceVersions } from '../schema/index.js';
import { nowSql, TeamApiError } from '../util.js';

/**
 * Version snapshots — append-only. Rollback creates a NEW version from an old
 * snapshot; history is never mutated.
 */

export function contentHashOf(row: Record<string, unknown>): string {
  // Strip identity/meta columns — only business content participates.
  const { id, teamId, projectId, ownerId, version, createdAt, updatedAt, ...content } = row;
  void id; void teamId; void projectId; void ownerId; void version; void createdAt; void updatedAt;
  const stable = JSON.stringify(content, (k, v) => (v === undefined ? null : v));
  return createHash('sha256').update(stable).digest('hex');
}

export async function writeSnapshot(input: {
  resourceType: string;
  resourceId: number;
  teamId: number;
  projectId: number | null;
  version: number;
  row: Record<string, unknown>;
  changedBy: number;
  changeSummary?: string;
  origin?: string;
}): Promise<void> {
  const db = getTeamDb();
  if (!db) return;
  await db.insert(resourceVersions).values({
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    teamId: input.teamId,
    projectId: input.projectId,
    version: input.version,
    snapshot: JSON.stringify(input.row),
    contentHash: contentHashOf(input.row),
    changeSummary: input.changeSummary?.slice(0, 500) ?? null,
    origin: input.origin?.slice(0, 120) ?? null,
    changedBy: input.changedBy,
    createdAt: nowSql(),
  });
}

export async function listVersions(
  resourceType: string,
  resourceId: number,
  teamId: number,
  limit = 50,
): Promise<Array<{ version: number; contentHash: string; changeSummary: string | null; origin: string | null; changedBy: number; createdAt: string }>> {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用');
  const rows = await db
    .select({
      version: resourceVersions.version,
      contentHash: resourceVersions.contentHash,
      changeSummary: resourceVersions.changeSummary,
      origin: resourceVersions.origin,
      changedBy: resourceVersions.changedBy,
      createdAt: resourceVersions.createdAt,
    })
    .from(resourceVersions)
    .where(
      and(
        eq(resourceVersions.resourceType, resourceType),
        eq(resourceVersions.resourceId, resourceId),
        eq(resourceVersions.teamId, teamId),
      ),
    )
    .orderBy(desc(resourceVersions.version))
    .limit(Math.min(limit, 200));
  return rows;
}

export async function getSnapshot(
  resourceType: string,
  resourceId: number,
  teamId: number,
  version: number,
): Promise<Record<string, unknown> | null> {
  const db = getTeamDb();
  if (!db) throw new TeamApiError(503, '团队功能未启用');
  const rows = await db
    .select({ snapshot: resourceVersions.snapshot })
    .from(resourceVersions)
    .where(
      and(
        eq(resourceVersions.resourceType, resourceType),
        eq(resourceVersions.resourceId, resourceId),
        eq(resourceVersions.teamId, teamId),
        eq(resourceVersions.version, version),
      ),
    )
    .limit(1);
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].snapshot) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Retention: keep the latest N versions per resource, compact older ones. */
export async function compactVersions(keep = 50): Promise<void> {
  const db = getTeamDb();
  if (!db) return;
  // delete versions that rank beyond `keep` within each (type, resource)
  await db.execute(sql`
    DELETE rv FROM resource_versions rv
    JOIN (
      SELECT resource_type, resource_id, team_id,
             SUBSTRING_INDEX(GROUP_CONCAT(id ORDER BY version DESC), ',', 1) AS keep_tail
      FROM resource_versions
      GROUP BY resource_type, resource_id, team_id
      HAVING COUNT(*) > ${keep}
    ) agg ON rv.resource_type = agg.resource_type AND rv.resource_id = agg.resource_id AND rv.team_id = agg.team_id
    WHERE rv.id NOT IN (
      SELECT id FROM (
        SELECT id FROM resource_versions v2
        WHERE v2.resource_type = rv.resource_type AND v2.resource_id = rv.resource_id AND v2.team_id = rv.team_id
        ORDER BY version DESC LIMIT ${keep}
      ) top
    )
  `);
}
