import db from './index.js';

// ── Row interfaces ──

export interface ScenarioRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  status: string;
  tags: string | null;
  parameters: string | null;
  test_type: string;
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
  pre_script?: string | null;
  post_script?: string | null;
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
  parameters?: string;
  test_type?: string;
}

export interface UpdateScenarioInput {
  name?: string;
  description?: string;
  status?: string;
  tags?: string;
  parameters?: string;
}

export interface ScenarioNodeInput {
  node_id: string;
  type: string;
  position_x: number;
  position_y: number;
  label?: string;
  config?: string;
  pre_script?: string;
  post_script?: string;
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

export function findScenariosByUserIdPaginated(userId: number, page: number, pageSize: number, sort = 'updated_at', order = 'DESC', testType?: string, name?: string): { items: ScenarioRow[]; total: number } {
  const offset = (page - 1) * pageSize;
  const validSorts: Record<string, string> = { updated_at: 'updated_at', created_at: 'created_at', name: 'name' };
  const sortCol = validSorts[sort] || 'updated_at';
  const sortDir = order === 'ASC' ? 'ASC' : 'DESC';
  const conditions: string[] = ['user_id = ?'];
  const params: (string | number)[] = [userId];
  if (testType) { conditions.push('test_type = ?'); params.push(testType); }
  if (name && name.trim()) {
    conditions.push('name LIKE ?');
    params.push(`%${name.trim()}%`);
  }
  const where = conditions.join(' AND ');
  const items = db.prepare(`SELECT * FROM scenarios WHERE ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as ScenarioRow[];
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM scenarios WHERE ${where}`).get(...params) as { count: number };
  return { items, total: count };
}

export function findScenariosByUserId(userId: number, testType?: string): ScenarioRow[] {
  if (testType) {
    return db.prepare('SELECT * FROM scenarios WHERE user_id = ? AND test_type = ? ORDER BY updated_at DESC').all(userId, testType) as ScenarioRow[];
  }
  return db.prepare('SELECT * FROM scenarios WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as ScenarioRow[];
}

export function findScenarioById(id: number): ScenarioRow | undefined {
  return db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id) as ScenarioRow | undefined;
}

export function createScenario(userId: number, data: CreateScenarioInput): number {
  const result = db.prepare(
    `INSERT INTO scenarios (user_id, name, description, status, tags, parameters, test_type)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, data.name, data.description || null, data.status || 'active', data.tags || '', data.parameters || '', data.test_type || 'api');
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
    `INSERT INTO scenario_nodes (scenario_id, node_id, type, position_x, position_y, label, config, pre_script, post_script)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const transaction = db.transaction(() => {
    deleteStmt.run(scenarioId);
    for (const node of nodes) {
      insertStmt.run(scenarioId, node.node_id, node.type, node.position_x, node.position_y, node.label || null, node.config || null, node.pre_script || null, node.post_script || null);
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

// ── 新执行日志表 ──

export interface ScenarioExecutionRow {
  id: number;
  scenario_id: number;
  status: string;
  trigger_type: string;
  executed_by: string | null;
  duration_ms: number | null;
  error_message: string | null;
  started_at: string;
  finished_at: string;
  batch_id: number;
}

export interface ScenarioExecutionStepRow {
  id: number;
  scenario_execution_id: number;
  step_order: number;
  log_type: string;
  node_id: string | null;
  node_type: string | null;
  log_text: string | null;
  log_data: string | null;
  param_row_index: number | null;
  created_at: string;
}

export interface ScenarioApiExecutionLinkRow {
  id: number;
  scenario_execution_id: number;
  node_id: string;
  param_row_index: number | null;
  api_execution_id: number;
  api_id: number | null;
}

export function createScenarioExecution(data: {
  scenario_id: number;
  status: string;
  trigger_type?: string;
  executed_by?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
  started_at: string;
  finished_at: string;
  batch_id?: number;
}): number {
  const result = db.prepare(
    `INSERT INTO scenario_executions (scenario_id, status, trigger_type, executed_by, duration_ms, error_message, started_at, finished_at, batch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.scenario_id,
    data.status,
    data.trigger_type ?? 'manual',
    data.executed_by ?? null,
    data.duration_ms ?? null,
    data.error_message ?? null,
    data.started_at,
    data.finished_at,
    data.batch_id ?? -1
  );
  return result.lastInsertRowid as number;
}

export function createScenarioExecutionStep(data: {
  scenario_execution_id: number;
  step_order: number;
  log_type: string;
  node_id?: string | null;
  node_type?: string | null;
  log_text?: string | null;
  log_data?: string | null;
  param_row_index?: number | null;
  created_at: string;
}): number {
  const result = db.prepare(
    `INSERT INTO scenario_execution_steps (scenario_execution_id, step_order, log_type, node_id, node_type, log_text, log_data, param_row_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.scenario_execution_id,
    data.step_order,
    data.log_type,
    data.node_id ?? null,
    data.node_type ?? null,
    data.log_text ?? null,
    data.log_data ? JSON.stringify(data.log_data) : null,
    data.param_row_index ?? null,
    data.created_at,
  );
  return result.lastInsertRowid as number;
}

export function linkScenarioApiExecution(data: {
  scenario_execution_id: number;
  node_id: string;
  param_row_index?: number | null;
  api_execution_id: number;
  api_id?: number | null;
}): number {
  const result = db.prepare(
    `INSERT INTO scenario_api_execution_links (scenario_execution_id, node_id, param_row_index, api_execution_id, api_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    data.scenario_execution_id,
    data.node_id,
    data.param_row_index ?? null,
    data.api_execution_id,
    data.api_id ?? null
  );
  return result.lastInsertRowid as number;
}

export function findScenarioExecutionsByScenarioId(scenarioId: number, limit = 20): ScenarioExecutionRow[] {
  return db.prepare('SELECT * FROM scenario_executions WHERE scenario_id = ? ORDER BY started_at DESC LIMIT ?').all(scenarioId, limit) as ScenarioExecutionRow[];
}

export function findScenarioExecutionWithSteps(executionId: number): (ScenarioExecutionRow & { steps: ScenarioExecutionStepRow[]; api_links: ScenarioApiExecutionLinkRow[] }) | null {
  const execution = db.prepare('SELECT * FROM scenario_executions WHERE id = ?').get(executionId) as ScenarioExecutionRow | undefined;
  if (!execution) return null;
  const steps = db.prepare('SELECT * FROM scenario_execution_steps WHERE scenario_execution_id = ? ORDER BY step_order').all(executionId) as ScenarioExecutionStepRow[];
  const api_links = db.prepare('SELECT * FROM scenario_api_execution_links WHERE scenario_execution_id = ?').all(executionId) as ScenarioApiExecutionLinkRow[];
  return { ...execution, steps, api_links };
}

export function findScenarioExecutionById(executionId: number): ScenarioExecutionRow | null {
  return db.prepare('SELECT * FROM scenario_executions WHERE id = ?').get(executionId) as ScenarioExecutionRow | null;
}

export function updateScenarioExecution(id: number, data: {
  status?: string;
  duration_ms?: number | null;
  error_message?: string | null;
  finished_at?: string;
  batch_id?: number;
}): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return false;
  values.push(id);
  const result = db.prepare(`UPDATE scenario_executions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

// ── 场景集执行 ──

export interface ScenarioSetExecutionRow {
  id: number;
  set_id: number;
  status: string;
  trigger_type: string;
  executed_by: string | null;
  total_count: number;
  passed_count: number;
  failed_count: number;
  skipped_count: number;
  total_duration_ms: number | null;
  started_at: string;
  finished_at: string;
}

export interface ScenarioSetExecutionItemRow {
  id: number;
  set_execution_id: number;
  scenario_id: number;
  scenario_name: string;
  status: string;
  duration_ms: number | null;
  error_message: string | null;
  scenario_execution_id: number | null;
}

export function createScenarioSetExecution(data: {
  set_id: number;
  status: string;
  trigger_type?: string;
  executed_by?: string | null;
  total_count?: number;
  passed_count?: number;
  failed_count?: number;
  skipped_count?: number;
  total_duration_ms?: number | null;
  started_at: string;
  finished_at: string;
}): number {
  const result = db.prepare(
    `INSERT INTO scenario_set_executions (set_id, status, trigger_type, executed_by, total_count, passed_count, failed_count, skipped_count, total_duration_ms, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.set_id,
    data.status,
    data.trigger_type ?? 'manual',
    data.executed_by ?? null,
    data.total_count ?? 0,
    data.passed_count ?? 0,
    data.failed_count ?? 0,
    data.skipped_count ?? 0,
    data.total_duration_ms ?? null,
    data.started_at,
    data.finished_at
  );
  return result.lastInsertRowid as number;
}

export function createScenarioSetExecutionItem(data: {
  set_execution_id: number;
  scenario_id: number;
  scenario_name: string;
  status: string;
  duration_ms?: number | null;
  error_message?: string | null;
  scenario_execution_id?: number | null;
}): number {
  const result = db.prepare(
    `INSERT INTO scenario_set_execution_items (set_execution_id, scenario_id, scenario_name, status, duration_ms, error_message, scenario_execution_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.set_execution_id,
    data.scenario_id,
    data.scenario_name,
    data.status,
    data.duration_ms ?? null,
    data.error_message ?? null,
    data.scenario_execution_id ?? null
  );
  return result.lastInsertRowid as number;
}

export function findScenarioSetExecutionsBySetId(setId: number, limit = 20): ScenarioSetExecutionRow[] {
  return db.prepare('SELECT * FROM scenario_set_executions WHERE set_id = ? ORDER BY started_at DESC LIMIT ?').all(setId, limit) as ScenarioSetExecutionRow[];
}

export function findScenarioSetExecutionWithItems(executionId: number): (ScenarioSetExecutionRow & { items: ScenarioSetExecutionItemRow[] }) | null {
  const execution = db.prepare('SELECT * FROM scenario_set_executions WHERE id = ?').get(executionId) as ScenarioSetExecutionRow | undefined;
  if (!execution) return null;
  const items = db.prepare('SELECT * FROM scenario_set_execution_items WHERE set_execution_id = ? ORDER BY id').all(executionId) as ScenarioSetExecutionItemRow[];
  return { ...execution, items };
}

export function updateScenarioSetExecution(id: number, data: {
  status?: string;
  passed_count?: number;
  failed_count?: number;
  skipped_count?: number;
  total_duration_ms?: number | null;
  finished_at?: string;
}): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return false;
  values.push(id);
  const result = db.prepare(`UPDATE scenario_set_executions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}
