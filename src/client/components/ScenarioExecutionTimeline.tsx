import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ScenarioExecutionStep, ScenarioApiExecutionLink } from '../../types';

const LOG_TYPE_LABELS: Record<string, string> = {
  scenario_start: '场景开始',
  node_start: '节点开始',
  node_end: '节点结束',
  condition: '条件评估',
  error: '错误',
  scenario_end: '场景结束',
};

const LOG_TYPE_CLASS: Record<string, string> = {
  scenario_start: 'step-start',
  node_start: 'step-main',
  node_end: 'step-end',
  condition: 'step-condition',
  error: 'step-error',
  scenario_end: 'step-finish',
};

const statusLabel = (status: string) => {
  switch (status) {
    case 'success': return '成功';
    case 'failed': return '失败';
    case 'error': return '错误';
    case 'skipped': return '跳过';
    default: return status;
  }
};

const tryParseJson = (text: string | null | Record<string, unknown>): Record<string, unknown> | null => {
  if (!text) return null;
  if (typeof text === 'object') return text;
  try { return JSON.parse(text); } catch { return null; }
};

interface Props {
  steps: ScenarioExecutionStep[];
  apiLinks: ScenarioApiExecutionLink[];
  /** When multiple scenario executions share the same timeline (e.g. in batch mode),
   *  use a unique key prefix to avoid cache key collisions */
  cacheKeyPrefix?: string;
}

export default function ScenarioExecutionTimeline({ steps, apiLinks, cacheKeyPrefix = '' }: Props) {
  const [expandedStep, setExpandedStep] = useState<number | string | null>(null);
  const navigate = useNavigate();

  return (
    <div className="scenario-exec-timeline">
      {steps.map((step, idx) => {
        const isExpanded = expandedStep === step.id;
        const logData = tryParseJson(step.log_data);
        const stepApiLinks = step.node_id ? apiLinks.filter(l => l.node_id === step.node_id) : [];

        return (
          <div key={step.id} className={`scenario-step ${LOG_TYPE_CLASS[step.log_type] || ''}`}>
            <div className="step-indicator">
              <div className="step-dot" />
              {idx < steps.length - 1 && <div className="step-line" />}
            </div>

            <div className="step-content">
              <div className="step-header" onClick={() => setExpandedStep(isExpanded ? null : step.id)}>
                <span className={`step-type-badge ${LOG_TYPE_CLASS[step.log_type] || ''}`}>
                  {LOG_TYPE_LABELS[step.log_type] || step.log_type}
                </span>
                <span className="step-node-id">{step.node_id || '—'}</span>
                <span className="step-toggle">{isExpanded ? '收起' : '展开'}</span>
              </div>

              <div className="step-log-text">{step.log_text || '—'}</div>

              {isExpanded && (
                <div className="step-detail">
                  <div className="step-section">
                    <div className="step-section-label">原始数据</div>
                    <div className="step-code">{step.log_data || '无'}</div>
                  </div>
                  {stepApiLinks.length > 0 && (
                    <div className="step-section">
                      <div className="step-section-label">API 执行记录</div>
                      {stepApiLinks.map(link => (
                        <div key={link.id} style={{ marginBottom: 4 }}>
                          <span
                            className="api-link-jump"
                            onClick={() => {
                              const targetApiId = link.api_id || logData?.api_id;
                              if (targetApiId) navigate(`/api-test/api-case/${targetApiId}?exec=${link.api_execution_id}`);
                            }}
                          >
                            API 执行 #{link.api_execution_id}{link.param_row_index != null && link.param_row_index >= 0 ? ` (行${link.param_row_index + 1})` : ''} →
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {logData && Object.keys(logData).length > 0 && (
                    <>
                      {logData.status && (
                        <div className="step-section">
                          <div className="step-section-label">状态</div>
                          <span className={`scenario-log-status scenario-log-${logData.status}`}>{statusLabel(String(logData.status))}</span>
                        </div>
                      )}
                      {logData.duration_ms != null && (
                        <div className="step-section">
                          <div className="step-section-label">耗时</div>
                          <span>{Number(logData.duration_ms)} ms</span>
                        </div>
                      )}
                      {logData.status_code != null && (
                        <div className="step-section">
                          <div className="step-section-label">状态码</div>
                          <span>{logData.status_code}</span>
                        </div>
                      )}
                      {logData.extract_values && typeof logData.extract_values === 'object' && Object.keys(logData.extract_values).length > 0 && (
                        <div className="step-section">
                          <div className="step-section-label">提取变量</div>
                          <div className="step-code">{JSON.stringify(logData.extract_values, null, 2)}</div>
                        </div>
                      )}
                      {logData.response_body && (
                        <div className="step-section">
                          <div className="step-section-label">响应内容</div>
                          <div className="step-code">{String(logData.response_body)}</div>
                        </div>
                      )}
                      {logData.assertion_results && Array.isArray(logData.assertion_results) && logData.assertion_results.length > 0 && (
                        <div className="step-section">
                          <div className="step-section-label">断言结果</div>
                          <div className="assert-results-list">
                            {logData.assertion_results.map((r: { passed?: boolean; actual?: string; expected?: string; source?: string; key?: string; operator?: string; param_row_index?: number }, ri: number) => (
                              <div key={ri} className={`assert-result-item ${r.passed ? 'passed' : 'failed'}`}>
                                <span className="assert-result-status">{r.passed ? '✓' : '✗'}</span>
                                <span className="assert-result-expr">{r.source}.{r.key} {r.operator} {r.expected}</span>
                                <span className="assert-result-actual">实际: {String(r.actual)}</span>
                                {r.param_row_index != null && <span className="assert-result-row">行{r.param_row_index + 1}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {logData.error && (
                        <div className="step-section">
                          <div className="step-section-label" style={{ color: '#e53e3e' }}>错误</div>
                          <div className="step-error-msg">{String(logData.error)}</div>
                        </div>
                      )}
                      {logData.condition_expr && (
                        <div className="step-section">
                          <div className="step-section-label">条件表达式</div>
                          <div className="step-code">{String(logData.condition_expr)}</div>
                        </div>
                      )}
                      {logData.result !== undefined && (
                        <div className="step-section">
                          <div className="step-section-label">评估结果</div>
                          <span className={logData.result ? 'scenario-exec-true' : 'scenario-exec-false'}>
                            {logData.result ? 'TRUE' : 'FALSE'}
                          </span>
                        </div>
                      )}
                      {logData.api_id && (
                        <div className="step-section">
                          <div className="step-section-label">API ID</div>
                          <span>{String(logData.api_id)}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}