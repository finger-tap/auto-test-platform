import {
  findScenarioById,
  findNodesByScenarioId,
  findEdgesByScenarioId,
  createScenarioExecution,
  createScenarioExecutionStep,
  linkScenarioApiExecution,
  updateScenarioExecution,
  findScenarioExecutionWithSteps,
  type ScenarioExecutionRow,
  type ScenarioExecutionStepRow,
  type ScenarioApiExecutionLinkRow,
  type ScenarioEdgeRow,
} from '../db/scenarios.js';
import { executeApi, extractValue, type ApiExecutionResult } from './api-executor.js';
import { executeScript, evalCondition as evalScriptCondition } from '../db/scripts/pre-post.js';
import { generateBatchId } from '../utils/id.js';

import { type AssertionRule, findApiById } from '../db/apis.js';

interface ApiNodeConfig {
  api_id: number;
  api_name?: string;
  extractions?: Array<{ var_name: string; source: 'status' | 'header' | 'body'; key: string }>;
  assertions?: AssertionRule[];
  extract_rules?: Array<{ var_name: string; source: 'status' | 'header' | 'body'; key: string }>;
  override_headers?: string;
  override_body?: string;
  pre_script?: string;
  post_script?: string;
}

interface ConditionNodeConfig {
  condition_expr: string;
}

interface ScenarioParamConfig {
  headers: string[];
  rows: string[][];
  enabledRows: boolean[];
}

// ── Condition Expression Parser ──

type TokenType = 'NUMBER' | 'STRING' | 'VAR' | 'OP' | 'LPAREN' | 'RPAREN' | 'EOF';

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue; }

    if (ch === '{') {
      const end = expr.indexOf('}', i);
      if (end === -1) throw new Error('Unclosed variable brace');
      tokens.push({ type: 'VAR', value: expr.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const end = expr.indexOf(ch, i + 1);
      if (end === -1) throw new Error('Unclosed string');
      tokens.push({ type: 'STRING', value: expr.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    if (i + 1 < expr.length) {
      const two = expr.slice(i, i + 2);
      if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
        tokens.push({ type: 'OP', value: two }); i += 2; continue;
      }
    }
    if (['>', '<'].includes(ch)) {
      tokens.push({ type: 'OP', value: ch }); i++; continue;
    }

    if (/[\d.]/.test(ch)) {
      let num = '';
      while (i < expr.length && /[\d.]/.test(expr[i])) { num += expr[i]; i++; }
      tokens.push({ type: 'NUMBER', value: num }); continue;
    }

    i++;
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

type ExprNode =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'var'; name: string }
  | { type: 'compare'; op: string; left: ExprNode; right: ExprNode }
  | { type: 'logic'; op: '&&' | '||'; left: ExprNode; right: ExprNode }
  | { type: 'not'; expr: ExprNode };

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) { this.tokens = tokens; this.pos = 0; }

  private peek(): Token { return this.tokens[this.pos]; }
  private advance(): Token { return this.tokens[this.pos++]; }

  parse(): ExprNode { return this.parseOr(); }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.peek().type === 'OP' && this.peek().value === '||') {
      this.advance();
      left = { type: 'logic', op: '||', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseAtom();
    while (this.peek().type === 'OP' && this.peek().value === '&&') {
      this.advance();
      left = { type: 'logic', op: '&&', left, right: this.parseAtom() };
    }
    return left;
  }

  private parseAtom(): ExprNode {
    if (this.peek().type === 'LPAREN') {
      this.advance();
      const expr = this.parseOr();
      if (this.peek().type !== 'RPAREN') throw new Error('Expected )');
      this.advance();
      return expr;
    }
    const left = this.parseValue();
    if (this.peek().type === 'OP') {
      const op = this.advance().value;
      return { type: 'compare', op, left, right: this.parseValue() };
    }
    return left;
  }

  private parseValue(): ExprNode {
    const token = this.peek();
    if (token.type === 'NUMBER') { this.advance(); return { type: 'number', value: parseFloat(token.value) }; }
    if (token.type === 'STRING') { this.advance(); return { type: 'string', value: token.value }; }
    if (token.type === 'VAR') { this.advance(); return { type: 'var', name: token.value }; }
    throw new Error(`Unexpected token: ${token.value || token.type}`);
  }
}

function evaluate(node: ExprNode, context: Record<string, string>): boolean {
  switch (node.type) {
    case 'number': return node.value !== 0;
    case 'string': return node.value !== '';
    case 'var': return context[node.name] !== '' && context[node.name] !== undefined;
    case 'compare': {
      const left = resolveValue(node.left, context);
      const right = resolveValue(node.right, context);
      return compare(left, right, node.op);
    }
    case 'logic': {
      const left = evaluate(node.left, context);
      const right = evaluate(node.right, context);
      return node.op === '&&' ? left && right : left || right;
    }
    case 'not': return !evaluate(node.expr, context);
  }
}

function resolveValue(node: ExprNode, context: Record<string, string>): string {
  switch (node.type) {
    case 'number': return String(node.value);
    case 'string': return node.value;
    case 'var': return context[node.name] ?? '';
    default: return String(evaluate(node, context));
  }
}

function compare(left: string, right: string, op: string): boolean {
  const leftNum = parseFloat(left);
  const rightNum = parseFloat(right);
  const isNumeric = !isNaN(leftNum) && !isNaN(rightNum);
  switch (op) {
    case '==': return isNumeric ? leftNum === rightNum : left === right;
    case '!=': return isNumeric ? leftNum !== rightNum : left !== right;
    case '>': return isNumeric ? leftNum > rightNum : left > right;
    case '<': return isNumeric ? leftNum < rightNum : left < right;
    case '>=': return isNumeric ? leftNum >= rightNum : left >= right;
    case '<=': return isNumeric ? leftNum <= rightNum : left <= right;
    default: return false;
  }
}

function evaluateCondition(expr: string, context: Record<string, string>): boolean {
  try {
    const tokens = tokenize(expr);
    return evaluate(new Parser(tokens).parse(), context);
  } catch { return false; }
}

// ── Scenario Executor ──

export async function executeScenario(
  scenarioId: number,
  executedBy: string,
  environmentId?: number
): Promise<ScenarioExecutionRow & { steps: ScenarioExecutionStepRow[]; api_links: ScenarioApiExecutionLinkRow[] }> {
  const scenario = findScenarioById(scenarioId);
  if (!scenario) throw new Error('Scenario not found');

  const nodes = findNodesByScenarioId(scenarioId);
  const edges = findEdgesByScenarioId(scenarioId);

  // Load environment
  const envContext: Record<string, string> = {};
  let envSSL: { cert?: string; key?: string; timeout?: number } = {};
  if (environmentId) {
    const { findEnvById, envToMap } = await import('../db/environments.js');
    const env = findEnvById(environmentId, scenario.user_id);
    if (env) {
      Object.assign(envContext, envToMap(env));
      if (env.ssl_cert || env.ssl_key) envSSL = { cert: env.ssl_cert || undefined, key: env.ssl_key || undefined };
      if (env.timeout) envSSL.timeout = env.timeout;
    }
  }

  let allDbConfigs: Record<string, import('../db/environments.js').DbConfig> | null = null;
  if (environmentId) {
    const { findEnvById, envToDbConfigs } = await import('../db/environments.js');
    const env = findEnvById(environmentId, scenario.user_id);
    allDbConfigs = envToDbConfigs(env);
  }

  // Build adjacency map
  const adjacency = new Map<string, ScenarioEdgeRow[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.source_node_id) || [];
    list.push(edge);
    adjacency.set(edge.source_node_id, list);
  }

  // Find start node
  const startNode = nodes.find((n) => n.type === 'start');
  if (!startNode) {
    throw new Error('流程图为空，请先编排场景流程');
  }

  // Parse scenario-level parameterization
  let paramConfig: ScenarioParamConfig | null = null;
  try { if (scenario.parameters) paramConfig = JSON.parse(scenario.parameters); } catch { /* ignore */ }

  let paramRows: Array<{ rowIdx: number; values: string[] }> = [];
  if (paramConfig && paramConfig.headers.length > 0) {
    paramRows = paramConfig.rows
      .map((row, i) => ({ rowIdx: i, values: row }))
      .filter(({ rowIdx }) => paramConfig!.enabledRows[rowIdx] !== false);
  }

  // Execute once per param row, first execution is batch leader
  const startedAt = new Date().toISOString();
  const executionIds: number[] = [];
  let batchLeaderId: number | null = null;
  // Generate a snowflake batch ID for all API executions in this scenario run
  const scenarioBatchId = generateBatchId();
  console.log('[executeScenario] scenarioBatchId:', scenarioBatchId);

  const executeOnce = async (
    initialContext: Record<string, string>,
    rowIdx: number | null,
    currentExecutionId: number
  ): Promise<{ overallStatus: string; errorMessage: string | null; duration: number }> => {
    const execStartedAt = new Date().toISOString();

    const stepOrder = { current: 0 };
    let currentParamRowIdx: number | null = rowIdx;

    const addStep = (logType: string, nodeId: string | null, nodeType: string | null, logText: string, logData: Record<string, unknown> = {}) => {
      stepOrder.current++;
      createScenarioExecutionStep({
        scenario_execution_id: currentExecutionId,
        step_order: stepOrder.current,
        log_type: logType,
        node_id: nodeId,
        node_type: nodeType,
        log_text: logText,
        log_data: JSON.stringify(logData),
        param_row_index: currentParamRowIdx,
        created_at: new Date().toISOString(),
      });
    };

    addStep('scenario_start', null, null, `开始执行场景: ${scenario.name}`, { scenario_id: scenarioId, scenario_name: scenario.name });

    const context: Record<string, string> = { ...initialContext };
    const queue: string[] = [startNode.node_id];
    const visited = new Set<string>();
    let overallStatus = 'success';
    let errorMessage: string | null = null;

    while (queue.length > 0) {
      const currentNodeId = queue.shift()!;
      if (visited.has(currentNodeId)) continue;
      visited.add(currentNodeId);

      const node = nodes.find((n) => n.node_id === currentNodeId);
      if (!node) continue;

      // Start node
      if (node.type === 'start') {
        addStep('node_start', node.node_id, 'start', `开始节点: 开始`);
        addStep('node_end', node.node_id, 'start', `完成节点: 开始 (0ms)`, { status: 'success', duration_ms: 0 });
        for (const next of getNextNodes(currentNodeId, adjacency, null)) queue.push(next);
        continue;
      }

      // End node
      if (node.type === 'end') {
        addStep('node_start', node.node_id, 'end', `开始节点: 结束`);
        addStep('node_end', node.node_id, 'end', `完成节点: 结束 (0ms)`, { status: 'success', duration_ms: 0 });
        break;
      }

      // API node
      if (node.type === 'api') {
        const config: ApiNodeConfig = node.config ? JSON.parse(node.config) : {};
        const nodeName = config.api_name || '接口节点';

        addStep('node_start', node.node_id, 'api', `开始节点: ${nodeName}`, { api_id: config.api_id });

        if (!config.api_id) {
          addStep('node_end', node.node_id, 'api', `完成节点: ${nodeName} - 错误: 未配置API`, { status: 'error', error: 'No API configured' });
          overallStatus = 'error';
          errorMessage = `节点 ${nodeName} 未配置API`;
          return { overallStatus, errorMessage, duration: 0 };
        }

        try {
          // Pre-script
          if (node.pre_script) {
            const preResult = await executeScript(node.pre_script, {
              vars: context,
              env: envContext,
              prevApi: undefined,
              dbConfigs: allDbConfigs,
            });
            if (!preResult.success) {
              addStep('pre_action', node.node_id, 'api', `前置脚本错误: ${preResult.error}`, { script: node.pre_script, error: preResult.error });
              addStep('node_end', node.node_id, 'api', `完成节点: ${nodeName} - 错误: 前置脚本失败`, { status: 'error', error: preResult.error });
              overallStatus = 'error';
              errorMessage = `前置脚本错误: ${preResult.error}`;
              return { overallStatus, errorMessage, duration: 0 };
            }
          }

          // Execute API with scenario execution context
          const apiResults = await executeApi(config.api_id, context, config.override_headers, config.override_body, {
            sslCert: envSSL.cert,
            sslKey: envSSL.key,
            timeout: envSSL.timeout,
            scenarioExecutionId: currentExecutionId,
            scenarioId,
            nodeId: node.node_id,
            executedBy,
            scenarioParamRowIndex: rowIdx,
            scenarioBatchId,
          });

          // Link all API executions (support parametrized API)
          for (const apiResult of apiResults) {
            linkScenarioApiExecution({
              scenario_execution_id: currentExecutionId,
              node_id: node.node_id,
              param_row_index: apiResult.param_row_index,
              api_execution_id: apiResult.execution_id,
              api_id: config.api_id,
            });
          }

          // Post-script (run after all param rows)
          if (node.post_script) {
            const lastResult = apiResults[apiResults.length - 1];
            const postResult = await executeScript(node.post_script, {
              vars: context,
              env: envContext,
              prevApi: lastResult ? {
                status_code: lastResult.status_code ?? 0,
                response_body: lastResult.response_body || '',
                response_headers: lastResult.response_headers,
              } : undefined,
              dbConfigs: allDbConfigs,
            });
            if (!postResult.success) {
              addStep('post_action', node.node_id, 'api', `后置脚本错误: ${postResult.error}`, { script: node.post_script, error: postResult.error });
              addStep('node_end', node.node_id, 'api', `完成节点: ${nodeName} - 错误: 后置脚本失败`, { status: 'error', error: postResult.error });
              overallStatus = 'error';
              errorMessage = `后置脚本错误: ${postResult.error}`;
              return { overallStatus, errorMessage, duration: 0 };
            }
          }

          // Extract values (from last result)
          const lastResult = apiResults[apiResults.length - 1];
          const extractValues: Record<string, string> = {};
          const extractionRules = config.extractions || config.extract_rules || [];
          for (const rule of extractionRules) {
            const value = extractValue(lastResult, rule.source, rule.key);
            extractValues[rule.var_name] = value;
            context[rule.var_name] = value;
          }

          // Assertions summary
          if (config.assertions && config.assertions.length > 0) {
            const allPassed = apiResults.every(r => r.status === 'success');
            const anyFailed = apiResults.some(r => r.status === 'failed');
            if (anyFailed) overallStatus = 'failed';
            // Collect assertion results from all API executions
            const allAssertionResults: Record<string, unknown>[] = [];
            for (const apiResult of apiResults) {
              if (apiResult.assertion_results) {
                // assertion_results is a phase-keyed object: { pre, main, post, final }
                const flat = [
                  ...apiResult.assertion_results.pre,
                  ...apiResult.assertion_results.main,
                  ...apiResult.assertion_results.post,
                  ...apiResult.assertion_results.final,
                ];
                allAssertionResults.push(...flat.map((r: { rule: AssertionRule; passed: boolean; actual: string }) => ({
                  param_row_index: apiResult.param_row_index,
                  passed: r.passed,
                  actual: r.actual,
                  expected: r.rule.expected,
                  source: r.rule.source,
                  key: r.rule.key,
                  operator: r.rule.operator,
                })));
              }
            }
            addStep('node_end', node.node_id, 'api', `完成节点: ${nodeName} 状态码:${lastResult.status_code} (${lastResult.duration_ms}ms)${anyFailed ? ' 有断言失败' : ''}`, {
              status: anyFailed ? 'failed' : 'success',
              duration_ms: lastResult.duration_ms,
              status_code: lastResult.status_code,
              response_body: lastResult.response_body ? String(lastResult.response_body).slice(0, 500) : null,
              extract_values: extractValues,
              assertion_results: allAssertionResults,
              assertions: config.assertions,
            });
          } else {
            const apiStatus = lastResult.status;
            if (apiStatus === 'error') overallStatus = 'error';
            else if (apiStatus === 'failed' && overallStatus !== 'error') overallStatus = 'failed';
            addStep('node_end', node.node_id, 'api', `完成节点: ${nodeName} 状态码:${lastResult.status_code} (${lastResult.duration_ms}ms)`, {
              status: lastResult.status,
              duration_ms: lastResult.duration_ms,
              status_code: lastResult.status_code,
              response_body: lastResult.response_body ? String(lastResult.response_body).slice(0, 500) : null,
              extract_values: extractValues,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          addStep('error', node.node_id, 'api', `节点执行异常: ${msg}`, { error: msg });
          addStep('node_end', node.node_id, 'api', `完成节点: ${nodeName} - 错误: ${msg}`, { status: 'error', error: msg });
          overallStatus = 'error';
          errorMessage = msg;
          return { overallStatus, errorMessage, duration: 0 };
        }

        for (const next of getNextNodes(currentNodeId, adjacency, null)) queue.push(next);
        continue;
      }

      // Condition node
      if (node.type === 'condition') {
        const config: ConditionNodeConfig = node.config ? JSON.parse(node.config) : {};
        const expr = config.condition_expr || '';
        const nodeName = expr ? (expr.length > 20 ? expr.slice(0, 20) + '...' : expr) : '条件节点';

        addStep('node_start', node.node_id, 'condition', `开始节点: ${nodeName}`, { condition_expr: expr });

        if (!expr) {
          addStep('condition', node.node_id, 'condition', `条件节点评估失败: 未配置表达式`, { result: false, error: 'No expression' });
          addStep('node_end', node.node_id, 'condition', `完成节点: ${nodeName} - 错误: 未配置表达式`, { status: 'error' });
          overallStatus = 'error';
          errorMessage = '条件节点未配置表达式';
          return { overallStatus, errorMessage, duration: 0 };
        }

        const condResult = evaluateCondition(expr, context);
        addStep('condition', node.node_id, 'condition', `评估条件: ${expr} → ${condResult ? 'TRUE' : 'FALSE'}`, {
          expr,
          result: condResult,
          context_snapshot: { ...context },
        });
        addStep('node_end', node.node_id, 'condition', `完成节点: ${nodeName} (${condResult ? 'true' : 'false'})`, { status: 'success', condition_result: condResult });

        for (const next of getNextNodes(currentNodeId, adjacency, condResult ? 'true' : 'false')) queue.push(next);
        continue;
      }

      // Unknown node type
      for (const next of getNextNodes(currentNodeId, adjacency, null)) queue.push(next);
    }

    const finishedAt = new Date().toISOString();
    const duration = new Date(finishedAt).getTime() - new Date(execStartedAt).getTime();

    addStep('scenario_end', null, null, `场景执行完成 - 状态: ${overallStatus} 耗时: ${duration}ms`, {
      status: overallStatus,
      duration_ms: duration,
    });

    updateScenarioExecution(currentExecutionId, {
      status: overallStatus,
      duration_ms: duration,
      error_message: errorMessage,
      finished_at: finishedAt,
    });

    return { overallStatus, errorMessage, duration };
  };

  // Execute once per param row, first is batch leader
  if (paramRows.length > 0) {
    for (const { rowIdx, values } of paramRows) {
      const paramContext: Record<string, string> = { ...envContext };
      for (let ci = 0; ci < paramConfig!.headers.length; ci++) {
        paramContext[paramConfig!.headers[ci]] = values[ci] || '';
      }
      const execId = createScenarioExecution({
        scenario_id: scenarioId,
        status: 'running',
        trigger_type: 'manual',
        executed_by: executedBy,
        started_at: startedAt,
        finished_at: startedAt,
        batch_id: -1, // temporary
      });
      executionIds.push(execId);
      if (batchLeaderId === null) batchLeaderId = execId;
    }
    // Update all with correct batch_id (use snowflake scenarioBatchId)
    for (const execId of executionIds) {
      updateScenarioExecution(execId, { batch_id: scenarioBatchId });
    }
    // Execute each
    for (let i = 0; i < paramRows.length; i++) {
      const { rowIdx, values } = paramRows[i];
      const paramContext: Record<string, string> = { ...envContext };
      for (let ci = 0; ci < paramConfig!.headers.length; ci++) {
        paramContext[paramConfig!.headers[ci]] = values[ci] || '';
      }
      await executeOnce(paramContext, rowIdx, executionIds[i]);
    }
  } else {
    const execId = createScenarioExecution({
      scenario_id: scenarioId,
      status: 'running',
      trigger_type: 'manual',
      executed_by: executedBy,
      started_at: startedAt,
      finished_at: startedAt,
    });
    executionIds.push(execId);
    batchLeaderId = execId;
    // Use snowflake scenarioBatchId for all scenario executions
    updateScenarioExecution(execId, { batch_id: scenarioBatchId });
    await executeOnce({ ...envContext }, null, execId);
  }

  // Return leader execution with sub_executions attached
  const leaderExecution = findScenarioExecutionWithSteps(batchLeaderId!) as (ScenarioExecutionRow & { steps: ScenarioExecutionStepRow[]; api_links: ScenarioApiExecutionLinkRow[] });
  if (paramRows.length > 1) {
    leaderExecution.api_links = [];
    for (const execId of executionIds) {
      const exec = findScenarioExecutionWithSteps(execId);
      if (exec && exec.api_links) {
        leaderExecution.api_links.push(...exec.api_links);
      }
    }
  }
  return leaderExecution;
}

function getNextNodes(
  currentNodeId: string,
  adjacency: Map<string, ScenarioEdgeRow[]>,
  handle: string | null
): string[] {
  const edges = adjacency.get(currentNodeId) || [];
  if (handle) {
    const edge = edges.find((e) => e.source_handle === handle);
    return edge ? [edge.target_node_id] : [];
  }
  const noHandleEdges = edges.filter((e) => !e.source_handle);
  if (noHandleEdges.length > 0) return noHandleEdges.map((e) => e.target_node_id);
  return edges.map((e) => e.target_node_id);
}