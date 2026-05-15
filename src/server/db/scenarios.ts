import db from './index.js';

// ── Row interfaces ──

export interface ScenarioRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  status: string;
  tags: string | null;
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

// ── Input interfaces ──

export interface CreateScenarioInput {
  name: string;
  description?: string;
  status?: string;
  tags?: string;
}

export interface UpdateScenarioInput {
  name?: string;
  description?: string;
  status?: string;
  tags?: string;
}

export interface ScenarioNodeInput {
  node_id: string;
  type: string;
  position_x: number;
  position_y: number;
  label?: string;
  config?: string;
}

export interface ScenarioEdgeInput {
  edge_id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle?: string;
  label?: string;
}

export interface CreateScenarioLogInput {
  status: string;
  trigger_type?: string;
  executed_by?: string;
  node_results?: string;
  duration_ms?: number;
  error_message?: string;
}

// ── Scenario CRUD ──

export function findScenariosByUserId(userId: number): ScenarioRow[] {
  return db.prepare('SELECT * FROM scenarios WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as ScenarioRow[];
}

export function findScenarioById(id: number): ScenarioRow | undefined {
  return db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id) as ScenarioRow | undefined;
}

export function createScenario(userId: number, data: CreateScenarioInput): number {
  const result = db.prepare(
    `INSERT INTO scenarios (user_id, name, description, status, tags)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, data.name, data.description || null, data.status || 'active', data.tags || '');
  return result.lastInsertRowid as number;
}

export function updateScenario(id: number, data: UpdateScenarioInput): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return false;

  fields.push("updated_at = datetime('now', '+8 hours')");
  values.push(id);

  const result = db.prepare(`UPDATE scenarios SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteScenario(id: number): boolean {
  const result = db.prepare('DELETE FROM scenarios WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Node operations ──

export function findNodesByScenarioId(scenarioId: number): ScenarioNodeRow[] {
  return db.prepare('SELECT * FROM scenario_nodes WHERE scenario_id = ?').all(scenarioId) as ScenarioNodeRow[];
}

export function upsertNodes(scenarioId: number, nodes: ScenarioNodeInput[]): void {
  const deleteStmt = db.prepare('DELETE FROM scenario_nodes WHERE scenario_id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO scenario_nodes (scenario_id, node_id, type, position_x, position_y, label, config)
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

// ── Edge operations ──

export function findEdgesByScenarioId(scenarioId: number): ScenarioEdgeRow[] {
  return db.prepare('SELECT * FROM scenario_edges WHERE scenario_id = ?').all(scenarioId) as ScenarioEdgeRow[];
}

export function upsertEdges(scenarioId: number, edges: ScenarioEdgeInput[]): void {
  const deleteStmt = db.prepare('DELETE FROM scenario_edges WHERE scenario_id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO scenario_edges (scenario_id, edge_id, source_node_id, target_node_id, source_handle, label)
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

// ── Log operations ──

export function createScenarioLog(scenarioId: number, data: CreateScenarioLogInput): number {
  const result = db.prepare(
    `INSERT INTO scenario_logs (scenario_id, status, trigger_type, executed_by, node_results, duration_ms, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(scenarioId, data.status, data.trigger_type || 'manual', data.executed_by || null, data.node_results || null, data.duration_ms || null, data.error_message || null);
  return result.lastInsertRowid as number;
}

export function findLogsByScenarioId(scenarioId: number, limit = 10): ScenarioLogRow[] {
  return db.prepare('SELECT * FROM scenario_logs WHERE scenario_id = ? ORDER BY executed_at DESC LIMIT ?').all(scenarioId, limit) as ScenarioLogRow[];
}
