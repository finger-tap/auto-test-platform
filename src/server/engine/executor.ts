import {
  findScenarioById,
  findNodesByScenarioId,
  findEdgesByScenarioId,
  createScenarioLog,
  type ScenarioNodeRow,
  type ScenarioEdgeRow,
} from '../db/scenarios.js';
import { executeApi, extractValue, evaluateAssertions, type ApiExecutionResult } from './api-executor.js';
import { executeScript, evalCondition as evalScriptCondition } from '../db/scripts/pre-post.js';

import { type AssertionRule } from '../db/apis.js';
import { findUserById } from '../db/users.js';

interface NodeExecutionResult {
  node_id: string;
  node_type: string;
  node_name?: string;
  status: 'success' | 'failed' | 'skipped' | 'error';
  api_id?: number | null;
  status_code?: number | null;
  request_headers?: string | null;
  request_body?: string | null;
  response_headers?: string | null;
  response_body?: string | null;
  duration_ms?: number | null;
  extract_values?: Record<string, string>;
  assertion_results?: Array<{ rule: { source: string; key: string; operator: string; expected: string; assert?: boolean }; passed: boolean; actual: string }>;
  condition_result?: boolean;
  error_message?: string | null;
}

interface ApiNodeConfig {
  api_id: number;
  api_name?: string;
  // 独立提取数组（新）
  extractions?: Array<{ var_name: string; source: 'status' | 'header' | 'body'; key: string }>;
  // 独立断言数组（新）
  assertions?: AssertionRule[];
  // 兼容旧数据
  extract_rules?: Array<{ var_name: string; source: 'status' | 'header' | 'body'; key: string }>;
  override_headers?: string;
  override_body?: string;
  pre_script?: string;
  post_script?: string;
}

interface ConditionNodeConfig {
  condition_expr: string;
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

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Parentheses
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }

    // Variable: {name}
    if (ch === '{') {
      const end = expr.indexOf('}', i);
      if (end === -1) throw new Error('Unclosed variable brace');
      tokens.push({ type: 'VAR', value: expr.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    // String: "..." or '...'
    if (ch === '"' || ch === "'") {
      const end = expr.indexOf(ch, i + 1);
      if (end === -1) throw new Error('Unclosed string');
      tokens.push({ type: 'STRING', value: expr.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    // Operators: ==, !=, >=, <=, >, <, &&, ||
    if (i + 1 < expr.length) {
      const two = expr.slice(i, i + 2);
      if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
        tokens.push({ type: 'OP', value: two });
        i += 2;
        continue;
      }
    }
    if (['>', '<'].includes(ch)) {
      tokens.push({ type: 'OP', value: ch });
      i++;
      continue;
    }

    // Number
    if (/[\d.]/.test(ch)) {
      let num = '';
      while (i < expr.length && /[\d.]/.test(expr[i])) {
        num += expr[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }

    // Unknown character - skip
    i++;
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

// Recursive descent parser
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

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  parse(): ExprNode {
    const node = this.parseOr();
    return node;
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.peek().type === 'OP' && this.peek().value === '||') {
      this.advance();
      const right = this.parseAnd();
      left = { type: 'logic', op: '||', left, right };
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseAtom();
    while (this.peek().type === 'OP' && this.peek().value === '&&') {
      this.advance();
      const right = this.parseAtom();
      left = { type: 'logic', op: '&&', left, right };
    }
    return left;
  }

  private parseAtom(): ExprNode {
    // Parenthesized expression
    if (this.peek().type === 'LPAREN') {
      this.advance();
      const expr = this.parseOr();
      if (this.peek().type !== 'RPAREN') throw new Error('Expected )');
      this.advance();
      return expr;
    }

    // Comparison: value op value
    const left = this.parseValue();

    if (this.peek().type === 'OP') {
      const op = this.advance().value;
      const right = this.parseValue();
      return { type: 'compare', op, left, right };
    }

    return left;
  }

  private parseValue(): ExprNode {
    const token = this.peek();

    if (token.type === 'NUMBER') {
      this.advance();
      return { type: 'number', value: parseFloat(token.value) };
    }

    if (token.type === 'STRING') {
      this.advance();
      return { type: 'string', value: token.value };
    }

    if (token.type === 'VAR') {
      this.advance();
      return { type: 'var', name: token.value };
    }

    throw new Error(`Unexpected token: ${token.value || token.type}`);
  }
}

function evaluate(node: ExprNode, context: Record<string, string>): boolean {
  switch (node.type) {
    case 'number':
      return node.value !== 0;
    case 'string':
      return node.value !== '';
    case 'var':
      return context[node.name] !== '' && context[node.name] !== undefined;
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
    case 'not':
      return !evaluate(node.expr, context);
  }
}

function resolveValue(node: ExprNode, context: Record<string, string>): string {
  switch (node.type) {
    case 'number':
      return String(node.value);
    case 'string':
      return node.value;
    case 'var':
      return context[node.name] ?? '';
    case 'compare':
    case 'logic':
      return String(evaluate(node, context));
    case 'not':
      return String(evaluate(node, context));
  }
}

function compare(left: string, right: string, op: string): boolean {
  // Try numeric comparison
  const leftNum = parseFloat(left);
  const rightNum = parseFloat(right);
  const isNumeric = !isNaN(leftNum) && !isNaN(rightNum);

  switch (op) {
    case '==':
      return isNumeric ? leftNum === rightNum : left === right;
    case '!=':
      return isNumeric ? leftNum !== rightNum : left !== right;
    case '>':
      return isNumeric ? leftNum > rightNum : left > right;
    case '<':
      return isNumeric ? leftNum < rightNum : left < right;
    case '>=':
      return isNumeric ? leftNum >= rightNum : left >= right;
    case '<=':
      return isNumeric ? leftNum <= rightNum : left <= right;
    default:
      return false;
  }
}

function evaluateCondition(expr: string, context: Record<string, string>): boolean {
  try {
    const tokens = tokenize(expr);
    const parser = new Parser(tokens);
    const ast = parser.parse();
    return evaluate(ast, context);
  } catch (err) {
    console.error('Condition evaluation error:', err);
    return false;
  }
}

// ── Scenario Executor ──

export async function executeScenario(scenarioId: number, executedBy: string, environmentId?: number) {
  const scenario = findScenarioById(scenarioId);
  if (!scenario) throw new Error('Scenario not found');

  const nodes = findNodesByScenarioId(scenarioId);
  const edges = findEdgesByScenarioId(scenarioId);
  const start = Date.now();

  // Build adjacency map
  const adjacency = new Map<string, ScenarioEdgeRow[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.source_node_id) || [];
    list.push(edge);
    adjacency.set(edge.source_node_id, list);
  }

// Load environment variables if environmentId provided
  const envContext: Record<string, string> = {};
  let envSSL: { cert?: string; key?: string; timeout?: number } = {};
  if (environmentId) {
    const { findEnvById, envToMap } = await import('../db/environments.js');
    const env = findEnvById(environmentId, scenario.user_id);
    if (env) {
      Object.assign(envContext, envToMap(env));
      if (env.ssl_cert || env.ssl_key) {
        envSSL = { cert: env.ssl_cert || undefined, key: env.ssl_key || undefined };
      }
      if (env.timeout) {
        envSSL.timeout = env.timeout;
      }
    }
  }

  // DB configs for script execution (supports multiple named databases)
  let allDbConfigs: Record<string, import('../db/environments.js').DbConfig> | null = null;
  if (environmentId) {
    const { findEnvById, envToDbConfigs } = await import('../db/environments.js');
    const env = findEnvById(environmentId, scenario.user_id);
    allDbConfigs = envToDbConfigs(env);
  }

  // Find start node
  const startNode = nodes.find((n) => n.type === 'start');
  if (!startNode) {
    const duration = Date.now() - start;
    const logId = createScenarioLog(scenarioId, {
      status: 'failed',
      trigger_type: 'manual',
      executed_by: executedBy,
      node_results: '{}',
      duration_ms: duration,
      error_message: '流程图为空，请先编排场景流程',
    });
    return {
      id: logId,
      scenario_id: scenarioId,
      status: 'failed',
      trigger_type: 'manual',
      executed_by: executedBy,
      node_results: '{}',
      duration_ms: duration,
      error_message: '流程图为空，请先编排场景流程',
      executed_at: new Date().toISOString(),
    };
  }

  // Context for variable passing (environment variables pre-loaded)
  const context: Record<string, string> = { ...envContext };
  const nodeResults: Record<string, NodeExecutionResult> = {};

  // BFS queue for parallel branch execution
  const queue: string[] = [startNode.node_id];
  const visited = new Set<string>();
  let hasError = false;

  while (queue.length > 0) {
    if (hasError) break;
    const currentNodeId = queue.shift()!;
    if (visited.has(currentNodeId)) continue;
    visited.add(currentNodeId);

    const node = nodes.find((n) => n.node_id === currentNodeId);
    if (!node) continue;

    // End node
    if (node.type === 'end') {
      nodeResults[currentNodeId] = {
        node_id: currentNodeId,
        node_type: 'end',
        node_name: '结束',
        status: 'success',
      };
      break;
    }

    // Start node
    if (node.type === 'start') {
      nodeResults[currentNodeId] = {
        node_id: currentNodeId,
        node_type: 'start',
        node_name: '开始',
        status: 'success',
      };
      for (const next of getNextNodes(currentNodeId, adjacency, null)) {
        queue.push(next);
      }
      continue;
    }

    // API node
    if (node.type === 'api') {
      const config: ApiNodeConfig = node.config ? JSON.parse(node.config) : {};
      const nodeName = config.api_name || '接口节点';

      if (!config.api_id) {
        nodeResults[currentNodeId] = {
          node_id: currentNodeId,
          node_type: 'api',
          node_name: nodeName,
          status: 'error',
          error_message: 'No API configured',
        };
        hasError = true;
        break;
      }

      try {
        // Pre-script: run before API call
        if (node.pre_script) {
          const preScript = node.pre_script || '';
          const preResult = await executeScript(preScript, {
            vars: context,
            env: envContext,
            prevApi: undefined,
            dbConfigs: allDbConfigs,
          });
          if (!preResult.success) {
            nodeResults[currentNodeId] = {
              node_id: currentNodeId,
              node_type: 'api',
              node_name: nodeName,
              status: 'error',
              error_message: `前置脚本错误: ${preResult.error}`,
            };
            hasError = true;
            break;
          }
        }

        const result = await executeApi(config.api_id, context, config.override_headers, config.override_body, {
          sslCert: envSSL.cert,
          sslKey: envSSL.key,
          timeout: envSSL.timeout,
        });

        // Post-script: run after API call
        if (node.post_script) {
          const postResult = await executeScript(node.post_script, {
            vars: context,
            env: envContext,
            prevApi: {
              status_code: result.status_code ?? 0,
              response_body: result.response_body || '',
              response_headers: result.response_headers ? JSON.parse(result.response_headers) : {},
            },
            dbConfigs: allDbConfigs,
          });
          if (!postResult.success) {
            nodeResults[currentNodeId] = {
              node_id: currentNodeId,
              node_type: 'api',
              node_name: nodeName,
              status: 'error',
              error_message: `后置脚本错误: ${postResult.error}`,
            };
            hasError = true;
            break;
          }
        }

        // Extract values — support both new extractions field and legacy extract_rules
        const extractValues: Record<string, string> = {};
        const extractionRules = config.extractions || config.extract_rules || [];
        for (const rule of extractionRules) {
          const value = extractValue(result, rule.source, rule.key);
          extractValues[rule.var_name] = value;
          context[rule.var_name] = value;
        }

        // Evaluate assertions
        let assertionResults: Array<{ rule: AssertionRule; passed: boolean; actual: string }> = [];
        const respHeaders: Record<string, string> = result.response_headers ? JSON.parse(result.response_headers) : {};

        if (config.assertions && config.assertions.length > 0) {
          const { results } = evaluateAssertions(config.assertions, result.status_code, respHeaders, result.response_body || '');
          assertionResults = results;
        }

        const assertionFailed = assertionResults.some((ar) => ar.rule.assert !== false && !ar.passed);

        const status = result.error_message ? 'error' : assertionFailed ? 'failed' : (result.status_code && result.status_code >= 200 && result.status_code < 400) ? 'success' : 'failed';

        nodeResults[currentNodeId] = {
          node_id: currentNodeId,
          node_type: 'api',
          node_name: nodeName,
          status,
          api_id: result.api_id,
          status_code: result.status_code,
          request_headers: result.request_headers,
          request_body: result.request_body,
          response_headers: result.response_headers,
          response_body: result.response_body,
          duration_ms: result.duration_ms,
          extract_values: extractValues,
          assertion_results: assertionResults.length > 0 ? assertionResults : undefined,
          error_message: result.error_message,
        };

        if (status === 'error' || assertionFailed) hasError = true;
      } catch (err) {
        nodeResults[currentNodeId] = {
          node_id: currentNodeId,
          node_type: 'api',
          node_name: nodeName,
          status: 'error',
          error_message: err instanceof Error ? err.message : 'Unknown error',
        };
        hasError = true;
      }

      for (const next of getNextNodes(currentNodeId, adjacency, null)) {
        queue.push(next);
      }
      continue;
    }

    // Condition node
    if (node.type === 'condition') {
      const config: ConditionNodeConfig = node.config ? JSON.parse(node.config) : {};
      const expr = config.condition_expr || '';
      const nodeName = expr ? (expr.length > 20 ? expr.slice(0, 20) + '...' : expr) : '条件节点';

      if (!expr) {
        nodeResults[currentNodeId] = {
          node_id: currentNodeId,
          node_type: 'condition',
          node_name: nodeName,
          status: 'error',
          error_message: 'No condition expression configured',
        };
        hasError = true;
        break;
      }

      const result = evaluateCondition(expr, context);

      nodeResults[currentNodeId] = {
        node_id: currentNodeId,
        node_type: 'condition',
        node_name: nodeName,
        status: 'success',
        condition_result: result,
      };

      // Follow the appropriate edge
      for (const next of getNextNodes(currentNodeId, adjacency, result ? 'true' : 'false')) {
        queue.push(next);
      }
      continue;
    }

    // Unknown node type - skip
    for (const next of getNextNodes(currentNodeId, adjacency, null)) {
      queue.push(next);
    }
  }

  const duration = Date.now() - start;
  const status = hasError ? 'failed' : 'success';

  // Save log
  const logId = createScenarioLog(scenarioId, {
    status,
    trigger_type: 'manual',
    executed_by: executedBy,
    node_results: JSON.stringify(nodeResults),
    duration_ms: duration,
  });

  return {
    id: logId,
    scenario_id: scenarioId,
    status,
    trigger_type: 'manual',
    executed_by: executedBy,
    node_results: JSON.stringify(nodeResults),
    duration_ms: duration,
    executed_at: new Date().toISOString(),
  };
}

function getNextNodes(
  currentNodeId: string,
  adjacency: Map<string, ScenarioEdgeRow[]>,
  handle: string | null
): string[] {
  const edges = adjacency.get(currentNodeId) || [];

  // If handle specified (for condition nodes), find matching edge
  if (handle) {
    const edge = edges.find((e) => e.source_handle === handle);
    return edge ? [edge.target_node_id] : [];
  }

  // Otherwise, follow all edges without a handle (parallel branches)
  const noHandleEdges = edges.filter((e) => !e.source_handle);
  if (noHandleEdges.length > 0) {
    return noHandleEdges.map((e) => e.target_node_id);
  }

  // Fallback: follow all edges
  return edges.map((e) => e.target_node_id);
}
