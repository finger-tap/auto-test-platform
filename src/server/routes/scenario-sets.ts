import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import {
  findSetsByUserIdPaginated,
  findSetsByUserId,
  findSetById,
  createSet,
  updateSet,
  deleteSet,
} from '../db/scenario-sets.js';
import {
  findScenariosByUserId,
  findScenarioById,
  findScenarioSetExecutionsBySetId,
  findScenarioSetExecutionWithItems,
  findScenarioExecutionWithSteps,
} from '../db/scenarios.js';
import { findUserById } from '../db/users.js';

export const setRoutes = Router();
setRoutes.use(authMiddleware);

function checkOwnership(req: Request, res: Response, setId: number) {
  if (!setId) { res.status(400).json({ code: 400, message: 'Invalid id' }); return null; }
  const set = findSetById(setId);
  if (!set) { res.status(404).json({ code: 404, message: 'Not found' }); return null; }
  if (set.user_id !== req.user!.userId) { res.status(403).json({ code: 403, message: 'Forbidden' }); return null; }
  return set;
}

// GET /api/scenario-sets
setRoutes.get('/', (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
  const sort = (req.query.sort as string) || 'updated_at';
  const order = (req.query.order as string) || 'DESC';
  const filters = {
    name: req.query.name as string,
    tags: req.query.tags as string,
    status: req.query.status as string,
  };
  const result = findSetsByUserIdPaginated(req.user!.userId, page, pageSize, filters, sort, order);
  res.json({ code: 200, message: 'ok', data: result });
});

// POST /api/scenario-sets
setRoutes.post('/', (req: Request, res: Response) => {
  const { name, description, scenario_ids, tags, status } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ code: 400, message: 'Name is required' });
    return;
  }
  const id = createSet(req.user!.userId, name.trim(), description, scenario_ids || [], tags, status);
  res.status(201).json({ code: 201, message: 'Created', data: { id } });
});

// GET /api/scenario-sets/:id
setRoutes.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const set = checkOwnership(req, res, id);
  if (!set) return;

  let scenarioIds: number[] = [];
  try { scenarioIds = JSON.parse(set.scenario_ids || '[]'); } catch { scenarioIds = []; }

  const allScenarios = findScenariosByUserId(req.user!.userId);
  const scenariosInSet = allScenarios.filter(s => scenarioIds.includes(s.id));

  res.json({
    code: 200,
    message: 'ok',
    data: { ...set, scenario_ids: scenarioIds, scenarios: scenariosInSet },
  });
});

// PUT /api/scenario-sets/:id
setRoutes.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const set = checkOwnership(req, res, id);
  if (!set) return;

  const { name, description, scenario_ids, tags, status } = req.body;
  updateSet(id, req.user!.userId, { name, description, scenario_ids, tags, status });
  res.json({ code: 200, message: 'Updated' });
});

// DELETE /api/scenario-sets/:id
setRoutes.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const set = checkOwnership(req, res, id);
  if (!set) return;
  deleteSet(id, req.user!.userId);
  res.json({ code: 200, message: 'Deleted' });
});

// POST /api/scenario-sets/:id/execute — batch run
setRoutes.post('/:id/execute', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const set = checkOwnership(req, res, id);
  if (!set) return;

  const executor = findUserById(req.user!.userId);
  const executedBy = executor?.nickname || executor?.account || 'unknown';

  try {
    const { runBatch } = await import('../engine/batch-executor.js');
    const environmentId = req.body.environmentId ? Number(req.body.environmentId) : undefined;
    const scenarioIds: number[] | undefined = Array.isArray(req.body.scenario_ids) && req.body.scenario_ids.length > 0 ? req.body.scenario_ids : undefined;

    const result = await runBatch(id, executedBy, environmentId, scenarioIds);
    res.json({ code: 200, message: 'ok', data: result });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Execution failed';
    res.status(500).json({ code: 500, message: errorMsg });
  }
});

// GET /api/scenario-sets/:id/executions — list all execution sessions
setRoutes.get('/:id/executions', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const set = checkOwnership(req, res, id);
  if (!set) return;

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const executions = findScenarioSetExecutionsBySetId(id, limit);
  res.json({ code: 200, message: 'ok', data: executions });
});

// GET /api/scenario-sets/:id/executions/:execId — get execution detail with scenario execution steps
setRoutes.get('/:id/executions/:execId', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const execId = Number(req.params.execId);
  const set = checkOwnership(req, res, id);
  if (!set) return;
  if (!execId) { res.status(400).json({ code: 400, message: 'Invalid execId' }); return; }

  const detail = findScenarioSetExecutionWithItems(execId);
  if (!detail) { res.status(404).json({ code: 404, message: 'Execution not found' }); return; }

  // Enrich each item with scenario execution steps and api links
  if (detail.items) {
    for (const item of detail.items) {
      if (item.scenario_execution_id) {
        const scenarioDetail = findScenarioExecutionWithSteps(item.scenario_execution_id);
        if (scenarioDetail) {
          (item as any).scenario_execution = scenarioDetail;
        }
      }
    }
  }

  res.json({ code: 200, message: 'ok', data: detail });
});

// GET /api/scenario-sets/:id/export-report — generate HTML report
setRoutes.get('/:id/export-report', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const set = checkOwnership(req, res, id);
  if (!set) return;

  let scenarioIds: number[] = [];
  try { scenarioIds = JSON.parse(set.scenario_ids || '[]'); } catch { scenarioIds = []; }

  // Load all executions with full details, ordered by started_at DESC
  const executions = findScenarioSetExecutionsBySetId(id, 100);
  const enrichedExecutions = executions.map(exec => {
    const detail = findScenarioSetExecutionWithItems(exec.id);
    if (!detail) return { ...exec, items: [] };
    const items = (detail.items || []).map(item => {
      if (!item.scenario_execution_id) return { ...item, scenario_execution: null };
      const scenarioExec = findScenarioExecutionWithSteps(item.scenario_execution_id);
      return { ...item, scenario_execution: scenarioExec || null };
    });
    return { ...detail, items };
  });

  // Build per-scenario latest execution data (keyed by scenario_id, first match wins since sorted DESC)
  const scenarioMap = new Map<number, {
    name: string;
    status: string;
    duration_ms: number | null;
    error_message: string | null;
    executed_at: string;
    executed_by: string | null;
    steps: any[] | null;
    api_links: any[] | null;
  }>();
  let lastExecutedAt = '';
  for (const exec of enrichedExecutions) {
    if (!lastExecutedAt && exec.started_at) lastExecutedAt = exec.started_at;
    for (const item of exec.items) {
      if (!scenarioMap.has(item.scenario_id)) {
        scenarioMap.set(item.scenario_id, {
          name: item.scenario_name,
          status: item.status,
          duration_ms: item.duration_ms,
          error_message: item.error_message,
          executed_at: exec.started_at,
          executed_by: exec.executed_by,
          steps: item.scenario_execution?.steps || null,
          api_links: item.scenario_execution?.api_links || null,
        });
      }
    }
  }

  // Build scenario list in set order, including never-executed ones
  const scenarioList = scenarioIds.map(sid => {
    const latest = scenarioMap.get(sid);
    if (latest) return { id: sid, ...latest };
    // Look up scenario name for never-executed
    const s = findScenarioById?.(sid);
    return { id: sid, name: s?.name || `场景 #${sid}`, status: 'not_executed', duration_ms: null, error_message: null, executed_at: '', executed_by: null, steps: null, api_links: null };
  });

  let totalPassed = 0;
  let totalFailed = 0;
  for (const s of scenarioList) {
    if (s.status === 'success') totalPassed++;
    else if (s.status !== 'not_executed' && s.status !== 'skipped') totalFailed++;
  }
  const totalNotExecuted = scenarioIds.length - totalPassed - totalFailed;

  const now = new Date();
  const exportTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const html = buildReportHtml({
    setName: set.name,
    setDescription: set.description,
    setTags: set.tags,
    totalScenarios: scenarioIds.length,
    totalPassed,
    totalFailed,
    totalNotExecuted,
    lastExecutedAt,
    exportTime,
    scenarioList,
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = { success: '成功', failed: '失败', error: '错误', skipped: '跳过', running: '运行中', not_executed: '未执行' };
  return map[status] || status;
}

function statusColor(status: string): string {
  const map: Record<string, string> = { success: '#10b981', failed: '#ef4444', error: '#ef4444', skipped: '#9ca3af', running: '#f59e0b', not_executed: '#9ca3af' };
  return map[status] || '#6b7280';
}

function logTypeLabel(logType: string): string {
  const map: Record<string, string> = {
    scenario_start: '开始', scenario_end: '结束',
    node_start: '节点开始', node_end: '节点结束',
    condition: '条件', error: '错误',
    pre_action: '前置', post_action: '后置', final_check: '验证',
  };
  return map[logType] || logType;
}

interface ReportData {
  setName: string;
  setDescription: string | null;
  setTags: string;
  totalScenarios: number;
  totalPassed: number;
  totalFailed: number;
  totalNotExecuted: number;
  lastExecutedAt: string;
  exportTime: string;
  scenarioList: {
    id: number;
    name: string;
    status: string;
    duration_ms: number | null;
    error_message: string | null;
    executed_at: string;
    executed_by: string | null;
    steps: any[] | null;
    api_links: any[] | null;
  }[];
}

function buildReportHtml(data: ReportData): string {
  const passRate = data.totalScenarios > 0 ? Math.round((data.totalPassed / data.totalScenarios) * 100) : 0;
  const tagBadges = data.setTags ? data.setTags.split(',').filter(Boolean).map(t =>
    `<span style="display:inline-block;padding:2px 10px;border-radius:12px;background:#f0f9ff;color:#0369a1;font-size:12px;margin-right:4px;">${escapeHtml(t.trim())}</span>`
  ).join('') : '';

  const scenarioRows = data.scenarioList.map((s, idx) => {
    const stepsHtml = buildStepsHtml({ steps: s.steps, api_links: s.api_links });
    const isNotExecuted = s.status === 'not_executed';
    return `
    <div style="background:#f9fafb;border-radius:12px;padding:16px 20px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span style="font-size:13px;color:#9ca3af;min-width:24px;">${idx + 1}</span>
        <span style="font-size:14px;font-weight:600;flex:1;">${escapeHtml(s.name)}</span>
        <span style="display:inline-block;padding:2px 12px;border-radius:10px;font-size:12px;color:#fff;background:${statusColor(s.status)};">${statusLabel(s.status)}</span>
        ${!isNotExecuted ? `<span style="font-size:13px;color:#6b7280;font-variant-numeric:tabular-nums;">${formatDuration(s.duration_ms)}</span>` : ''}
        ${!isNotExecuted && s.executed_at ? `<span style="font-size:12px;color:#9ca3af;">${new Date(s.executed_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span>` : ''}
        ${!isNotExecuted && s.executed_by ? `<span style="font-size:12px;color:#9ca3af;">${escapeHtml(s.executed_by)}</span>` : ''}
      </div>
      ${s.error_message ? `<div style="margin-top:8px;padding:8px 12px;background:#fef2f2;border-radius:6px;font-size:12px;color:#dc2626;">${escapeHtml(s.error_message)}</div>` : ''}
      ${stepsHtml ? `<div style="margin-top:8px;">${stepsHtml}</div>` : ''}
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>测试执行报告 - ${escapeHtml(data.setName)}</title>
<style>
  @page { margin: 15mm; size: A4; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #1f2937; line-height: 1.6; background: #f3f4f6; }
  .page { max-width: 900px; margin: 0 auto; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: #fff; padding: 40px 48px; }
  .header h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; letter-spacing: 1px; }
  .header .subtitle { font-size: 18px; font-weight: 500; opacity: 0.9; margin-bottom: 12px; }
  .header .meta { font-size: 13px; opacity: 0.75; display: flex; gap: 24px; flex-wrap: wrap; }
  .content { padding: 32px 48px; }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px; }
  .stat-card { border-radius: 12px; padding: 20px; text-align: center; }
  .stat-card.passed { background: #ecfdf5; border: 1px solid #a7f3d0; }
  .stat-card.failed { background: #fef2f2; border: 1px solid #fecaca; }
  .stat-card.pending { background: #f9fafb; border: 1px solid #e5e7eb; }
  .stat-card .number { font-size: 36px; font-weight: 700; line-height: 1.2; }
  .stat-card.passed .number { color: #059669; }
  .stat-card.failed .number { color: #dc2626; }
  .stat-card.pending .number { color: #6b7280; }
  .stat-card .label { font-size: 13px; color: #6b7280; margin-top: 4px; }
  .stat-card .pct { font-size: 14px; font-weight: 600; margin-top: 2px; }
  .stat-card.passed .pct { color: #059669; }
  .stat-card.failed .pct { color: #dc2626; }
  .stat-card.pending .pct { color: #6b7280; }
  .section-title { font-size: 16px; font-weight: 700; color: #111827; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
  .timeline { padding: 8px 0 8px 20px; margin: 8px 0; border-left: 2px solid #e5e7eb; }
  .timeline-item { position: relative; padding: 4px 0 4px 16px; font-size: 12px; color: #4b5563; }
  .timeline-item::before { content: ''; position: absolute; left: -25px; top: 10px; width: 8px; height: 8px; border-radius: 50%; background: #d1d5db; border: 2px solid #fff; }
  .timeline-item.node-start::before { background: #3b82f6; }
  .timeline-item.node-end::before { background: ${statusColor('success')}; }
  .timeline-item.error::before { background: #ef4444; }
  .timeline-item .step-label { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-right: 6px; background: #f3f4f6; color: #374151; }
  .timeline-item .step-time { color: #9ca3af; font-size: 11px; margin-left: 8px; }
  .timeline-item .step-detail { display: block; margin-top: 4px; padding: 6px 10px; background: #f9fafb; border-radius: 6px; font-family: "SF Mono", Monaco, "Cascadia Code", monospace; font-size: 11px; color: #6b7280; white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow: hidden; }
  .footer { padding: 24px 48px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #9ca3af; }
  @media print {
    body { background: #fff; }
    .page { box-shadow: none; }
    .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .stat-card, .stat-card .number { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1>测试执行报告</h1>
    <div class="subtitle">${escapeHtml(data.setName)}</div>
    ${data.setDescription ? `<div style="font-size:14px;opacity:0.85;margin-bottom:8px;">${escapeHtml(data.setDescription)}</div>` : ''}
    ${tagBadges ? `<div style="margin-bottom:4px;">${tagBadges}</div>` : ''}
    <div class="meta">
      <span>导出时间: ${data.exportTime}</span>
      <span>最近执行: ${data.lastExecutedAt ? new Date(data.lastExecutedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未执行'}</span>
    </div>
  </div>

  <div class="content">
    <div class="summary">
      <div class="stat-card passed">
        <div class="number">${data.totalPassed}</div>
        <div class="label">成功</div>
        <div class="pct">${data.totalScenarios > 0 ? passRate : 0}%</div>
      </div>
      <div class="stat-card failed">
        <div class="number">${data.totalFailed}</div>
        <div class="label">失败</div>
        <div class="pct">${data.totalScenarios > 0 ? Math.round((data.totalFailed / data.totalScenarios) * 100) : 0}%</div>
      </div>
      <div class="stat-card pending">
        <div class="number">${data.totalNotExecuted}</div>
        <div class="label">未执行</div>
        <div class="pct">${data.totalScenarios > 0 ? Math.round((data.totalNotExecuted / data.totalScenarios) * 100) : 0}%</div>
      </div>
    </div>

    <div class="section-title">场景执行结果</div>
    ${scenarioRows || '<div style="text-align:center;color:#9ca3af;padding:24px;">暂无场景</div>'}
  </div>

  <div class="footer">Auto Test Platform 自动生成</div>
</div>
</body>
</html>`;
}

function buildStepsHtml(scenarioExecution: any): string {
  if (!scenarioExecution || !scenarioExecution.steps || scenarioExecution.steps.length === 0) return '';

  const items = scenarioExecution.steps.map((step: any) => {
    let detail = '';
    if (step.log_data) {
      try {
        const d = typeof step.log_data === 'string' ? JSON.parse(step.log_data) : step.log_data;
        const lines: string[] = [];
        if (d.status) lines.push(`状态: ${d.status}`);
        if (d.status_code) lines.push(`HTTP ${d.status_code}`);
        if (d.duration_ms != null) lines.push(`耗时: ${d.duration_ms}ms`);
        if (d.error) lines.push(`错误: ${d.error}`);
        if (d.assertion_results && d.assertion_results.length > 0) {
          const passed = d.assertion_results.filter((a: any) => a.passed).length;
          lines.push(`断言: ${passed}/${d.assertion_results.length} 通过`);
          for (const a of d.assertion_results) {
            lines.push(`  ${a.passed ? '✓' : '✗'} ${a.key || ''} ${a.operator || ''} ${a.expected ?? ''} → ${a.actual ?? ''}`);
          }
        }
        if (d.condition_expr) lines.push(`条件: ${d.condition_expr} → ${d.result}`);
        if (d.response_body) lines.push(`响应体: ${String(d.response_body).substring(0, 200)}`);
        detail = lines.join('\n');
      } catch { /* ignore */ }
    }
    if (step.log_text && !detail) detail = escapeHtml(step.log_text);

    return `<div class="timeline-item ${step.log_type}">
      <span class="step-label">${logTypeLabel(step.log_type)}</span>
      ${escapeHtml(step.log_text || step.node_type || '')}
      ${step.log_data ? (() => { try { const d = typeof step.log_data === 'string' ? JSON.parse(step.log_data) : step.log_data; return d.duration_ms != null ? `<span class="step-time">${d.duration_ms}ms</span>` : ''; } catch { return ''; } })() : ''}
      ${detail ? `<div class="step-detail">${detail}</div>` : ''}
    </div>`;
  }).join('');

  return `<div class="timeline">${items}</div>`;
}
setRoutes.get('/:id/reports', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const set = checkOwnership(req, res, id);
  if (!set) return;

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const reports = findScenarioSetExecutionsBySetId(id, limit);
  res.json({ code: 200, message: 'ok', data: reports });
});
