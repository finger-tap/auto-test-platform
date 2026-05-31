import db from './index.js';

export interface ScenarioRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  status: string;
  tags: string | null;
  parameters: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScenarioNodeRow {
  id: number;
  scenario_id: number;
  node_id: string;
  type: 'start' | 'api' | 'condition' | 'end';
  position_x: number;
  position_y: number;
  label: string | null;
  config: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScenarioEdgeRow {
  id: number;
  scenario_id: number;
  edge_id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle: string | null;
  label: string | null;
  created_at: string;
}

export interface ScenarioLogRow {
  id: number;
  scenario_id: number;
  status: string;
  trigger_type: string;
  executed_by: string | null;
  node_results: string | null;
  duration_ms: number | null;
  error_message: string | null;
  executed_at: string;
}

export function findScenariosByUserIdPaginated(
  userId: number,
  page: number,
  pageSize: number,
  sort = 'updated_at',
  order = 'DESC'
): { items: ScenarioRow[]; total: number } {
  const offset = (page - 1) * pageSize;
  const validSorts: Record<string, string> = { updated_at: 'updated_at', created_at: 'created_at', name: 'name' };
  const sortCol = validSorts[sort] || 'updated_at';
  const sortDir = order === 'ASC' ? 'ASC' : 'DESC';
  const items = db.prepare(
    `SELECT * FROM scenarios_pc WHERE user_id = ? ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`
  ).all(userId, pageSize, offset) as ScenarioRow[];
  const { count } = db.prepare(
    `SELECT COUNT(*) AS count FROM scenarios_pc WHERE user_id = ?`
  ).get(userId) as { count: number };
  return { items, total: count };
}

export function findScenariosByUserId(userId: number): ScenarioRow[] {
  return db.prepare('SELECT * FROM scenarios_pc WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as ScenarioRow[];
}

export function findScenarioById(id: number): ScenarioRow | undefined {
  return db.prepare('SELECT * FROM scenarios_pc WHERE id = ?').get(id) as ScenarioRow | undefined;
}

export function createScenario(userId: number, data: { name: string; description?: string; status?: string; tags?: string; parameters?: string }): number {
  const result = db.prepare(
    `INSERT INTO scenarios_pc (user_id, name, description, status, tags, parameters)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    data.name,
    data.description || null,
    data.status || 'active',
    data.tags || '',
    data.parameters || ''
  );
  return result.lastInsertRowid as number;
}

export function updateScenario(id: number, data: { name?: string; description?: string | null; status?: string; tags?: string; parameters?: string }): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.tags !== undefined) { fields.push('tags = ?'); values.push(data.tags); }
  if (data.parameters !== undefined) { fields.push('parameters = ?'); values.push(data.parameters); }

  if (fields.length === 0) return false;

  fields.push("updated_at = datetime('now', '+8 hours')");
  values.push(id);

  const result = db.prepare(`UPDATE scenarios_pc SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteScenario(id: number): boolean {
  const result = db.prepare('DELETE FROM scenarios_pc WHERE id = ?').run(id);
  return result.changes > 0;
}

export function findNodesByScenarioId(scenarioId: number): ScenarioNodeRow[] {
  return db.prepare('SELECT * FROM scenario_nodes_pc WHERE scenario_id = ?').all(scenarioId) as ScenarioNodeRow[];
}

export function upsertNodes(scenarioId: number, nodes: Array<{ node_id: string; type: string; position_x: number; position_y: number; label?: string; config?: string }>): void {
  const deleteStmt = db.prepare('DELETE FROM scenario_nodes_pc WHERE scenario_id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO scenario_nodes_pc (scenario_id, node_id, type, position_x, position_y, label, config)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const transaction = db.transaction(() => {
    deleteStmt.run(scenarioId);
    for (const node of nodes) {
      insertStmt.run(scenarioId, node.node_id, node.type, node.position_x, node.position_y, node.label || null, node.config || null);
    }
  });
  transaction();
}

export function findEdgesByScenarioId(scenarioId: number): ScenarioEdgeRow[] {
  return db.prepare('SELECT * FROM scenario_edges_pc WHERE scenario_id = ?').all(scenarioId) as ScenarioEdgeRow[];
}

export function upsertEdges(scenarioId: number, edges: Array<{ edge_id: string; source_node_id: string; target_node_id: string; source_handle?: string; label?: string }>): void {
  const deleteStmt = db.prepare('DELETE FROM scenario_edges_pc WHERE scenario_id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO scenario_edges_pc (scenario_id, edge_id, source_node_id, target_node_id, source_handle, label)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const transaction = db.transaction(() => {
    deleteStmt.run(scenarioId);
    for (const edge of edges) {
      insertStmt.run(scenarioId, edge.edge_id, edge.source_node_id, edge.target_node_id, edge.source_handle || null, edge.label || null);
    }
  });
  transaction();
}

export function createScenarioLog(scenarioId: number, data: { status: string; trigger_type?: string; executed_by?: string; node_results?: string; duration_ms?: number; error_message?: string }): number {
  const result = db.prepare(
    `INSERT INTO scenario_logs_pc (scenario_id, status, trigger_type, executed_by, node_results, duration_ms, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    scenarioId,
    data.status,
    data.trigger_type || 'manual',
    data.executed_by || null,
    data.node_results || null,
    data.duration_ms || null,
    data.error_message || null
  );
  return result.lastInsertRowid as number;
}

export function findLogsByScenarioId(scenarioId: number, limit = 10): ScenarioLogRow[] {
  return db.prepare('SELECT * FROM scenario_logs_pc WHERE scenario_id = ? ORDER BY executed_at DESC LIMIT ?').all(scenarioId, limit) as ScenarioLogRow[];
}
