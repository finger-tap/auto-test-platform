import db from "../db/index.js";

export interface MockEndpointRow {
  id: number;
  user_id: number;
  name: string;
  method: string; // GET|POST|PUT|DELETE|PATCH|*
  path_pattern: string; // e.g. /api/users/:id
  description: string | null;
  tags: string | null;
  status: string | null;
  // Response config (JSON string)
  response_status: number; // HTTP status code
  response_headers: string; // JSON string
  response_body: string; // JSON string (body content)
  response_delay_ms: number; // Simulated latency (ms)
  // Conditions
  conditions: string; // JSON: { param: string, operator: string, value: string }[]
  // Match mode
  match_mode: "exact" | "contains" | "regex" | "wildcard";
  // Metadata
  enabled: number; // 0 or 1
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
  updated_at: string;
}

export function findMocksByUserIdPaginated(
  userId: number,
  page: number,
  pageSize: number,
  testType?: string,
): { items: MockEndpointRow[]; total: number } {
  const offset = (page - 1) * pageSize;
  const conditions: string[] = ["user_id = ?"];
  const params: (string | number)[] = [userId];
  if (testType) {
    conditions.push("test_type = ?");
    params.push(testType);
  }
  const where = conditions.join(" AND ");
  const items = db
    .prepare(
      `SELECT * FROM mock_endpoints WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset) as MockEndpointRow[];
  const { count } = db
    .prepare(`SELECT COUNT(*) AS count FROM mock_endpoints WHERE ${where}`)
    .get(...params) as { count: number };
  return { items, total: count };
}

export function findMockById(
  id: number,
  testType?: string,
): MockEndpointRow | undefined {
  if (testType) {
    return db
      .prepare("SELECT * FROM mock_endpoints WHERE id = ? AND test_type = ?")
      .get(id, testType) as MockEndpointRow | undefined;
  }
  return db.prepare("SELECT * FROM mock_endpoints WHERE id = ?").get(id) as
    | MockEndpointRow
    | undefined;
}

/**
 * Get all mocks for a user (no pagination, for engine lookup).
 */
export function findMocksByUserId(
  userId: number,
  testType?: string,
): MockEndpointRow[] {
  if (testType) {
    return db
      .prepare(
        "SELECT * FROM mock_endpoints WHERE user_id = ? AND test_type = ? ORDER BY updated_at DESC",
      )
      .all(userId, testType) as MockEndpointRow[];
  }
  return db
    .prepare(
      "SELECT * FROM mock_endpoints WHERE user_id = ? ORDER BY updated_at DESC",
    )
    .all(userId) as MockEndpointRow[];
}

export function createMock(data: {
  userId: number;
  name: string;
  method: string;
  path_pattern: string;
  description?: string;
  tags?: string;
  status?: string;
  response_status?: number;
  response_headers?: string;
  response_body?: string;
  response_delay_ms?: number;
  conditions?: string;
  match_mode?: string;
  enabled?: boolean;
  test_type?: string;
}): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
    INSERT INTO mock_endpoints
      (user_id, name, method, path_pattern, description, tags, status, response_status, response_headers, response_body,
       response_delay_ms, conditions, match_mode, enabled, hit_count, last_hit_at, test_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)
  `,
    )
    .run(
      data.userId,
      data.name,
      data.method || "*",
      data.path_pattern,
      data.description || null,
      data.tags || null,
      data.status || "active",
      data.response_status || 200,
      data.response_headers || '{"Content-Type":"application/json"}',
      data.response_body || "{}",
      data.response_delay_ms || 0,
      data.conditions || "[]",
      data.match_mode || "exact",
      data.enabled !== false ? 1 : 0,
      data.test_type || "api",
      now,
      now,
    );
  return result.lastInsertRowid as number;
}

export function updateMock(
  id: number,
  userId: number,
  data: Partial<{
    name: string;
    method: string;
    path_pattern: string;
    description: string | null;
    tags: string | null;
    status: string | null;
    response_status: number;
    response_headers: string;
    response_body: string;
    response_delay_ms: number;
    conditions: string;
    match_mode: string;
    enabled: boolean;
    test_type: string;
  }>,
): boolean {
  const fields: string[] = [];
  const vals: unknown[] = [];

  if (data.name !== undefined) {
    fields.push("name = ?");
    vals.push(data.name);
  }
  if (data.method !== undefined) {
    fields.push("method = ?");
    vals.push(data.method);
  }
  if (data.path_pattern !== undefined) {
    fields.push("path_pattern = ?");
    vals.push(data.path_pattern);
  }
  if (data.description !== undefined) {
    fields.push("description = ?");
    vals.push(data.description);
  }
  if (data.tags !== undefined) {
    fields.push("tags = ?");
    vals.push(data.tags);
  }
  if (data.status !== undefined) {
    fields.push("status = ?");
    vals.push(data.status);
  }
  if (data.response_status !== undefined) {
    fields.push("response_status = ?");
    vals.push(data.response_status);
  }
  if (data.response_headers !== undefined) {
    fields.push("response_headers = ?");
    vals.push(data.response_headers);
  }
  if (data.response_body !== undefined) {
    fields.push("response_body = ?");
    vals.push(data.response_body);
  }
  if (data.response_delay_ms !== undefined) {
    fields.push("response_delay_ms = ?");
    vals.push(data.response_delay_ms);
  }
  if (data.conditions !== undefined) {
    fields.push("conditions = ?");
    vals.push(data.conditions);
  }
  if (data.match_mode !== undefined) {
    fields.push("match_mode = ?");
    vals.push(data.match_mode);
  }
  if (data.enabled !== undefined) {
    fields.push("enabled = ?");
    vals.push(data.enabled ? 1 : 0);
  }
  if (data.test_type !== undefined) {
    fields.push("test_type = ?");
    vals.push(data.test_type);
  }

  if (fields.length === 0) return false;

  fields.push("updated_at = datetime('now', '+8 hours')");
  vals.push(id, userId);

  const result = db
    .prepare(
      `UPDATE mock_endpoints SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
    )
    .run(...vals);
  return result.changes > 0;
}

export function deleteMock(id: number, userId: number): boolean {
  const result = db
    .prepare("DELETE FROM mock_endpoints WHERE id = ? AND user_id = ?")
    .run(id, userId);
  return result.changes > 0;
}

export function incrementMockHit(id: number): void {
  db.prepare(
    "UPDATE mock_endpoints SET hit_count = hit_count + 1, last_hit_at = datetime('now', '+8 hours') WHERE id = ?",
  ).run(id);
}

export function resetMockHitCount(id: number): void {
  db.prepare("UPDATE mock_endpoints SET hit_count = 0 WHERE id = ?").run(id);
}
