import { useState } from 'react';
import { apiFetch } from '../utils/api';
import type { ScenarioExecutionStep, ScenarioApiExecutionLink, ApiExecution, ApiExecutionStep } from '../../types';

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

const API_STEP_LABELS: Record<string, string> = {
  api_start: '开始',
  pre_action: '前置动作',
  main_action: '主体请求',
  post_action: '后置动作',
  assertion: '断言',
  api_end: '结束',
};

const API_STEP_CLASS: Record<string, string> = {
  api_start: 'step-start',
  pre_action: 'step-pre',
  main_action: 'step-main',
  post_action: 'step-post',
  assertion: 'step-assert',
  api_end: 'step-end',
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

interface ApiLinkDetail {
  link: ScenarioApiExecutionLink;
  detail: ApiExecution & { steps: ApiExecutionStep[] } | null;
  loading: boolean;
}

interface Props {
  steps: ScenarioExecutionStep[];
  apiLinks: ScenarioApiExecutionLink[];
  /** When multiple scenario executions share the same timeline (e.g. in batch mode),
   *  use a unique key prefix to avoid cache key collisions */
  cacheKeyPrefix?: string;
}

export default function ScenarioExecutionTimeline({ steps, apiLinks, cacheKeyPrefix = '' }: Props) {
  const [expandedStep, setExpandedStep] = useState<number | string | null>(null);
  const [apiLinkDetails, setApiLinkDetails] = useState<Record<string, ApiLinkDetail>>({});

  const cacheKey = (link: ScenarioApiExecutionLink) => `${cacheKeyPrefix}${link.id}`;

  const fetchApiLinkDetail = (link: ScenarioApiExecutionLink, apiId: number) => {
    const key = cacheKey(link);
    const cached = apiLinkDetails[key];
    if (cached?.detail) return;

    setApiLinkDetails(prev => ({
      ...prev,
      [key]: { link, detail: null, loading: true },
    }));

    apiFetch<ApiExecution & { steps: ApiExecutionStep[] }>(`/apis/${apiId}/executions/${link.api_execution_id}`).then((res) => {
      if (res.code === 200 && res.data) {
        setApiLinkDetails(prev => ({
          ...prev,
          [key]: { link, detail: res.data!, loading: false },
        }));
      }
    });
  };

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

              {isExpanded && logData && (
                <div className="step-detail">
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
                  {stepApiLinks.length > 0 && logData?.api_id && (
                    <div className="step-section">
                      <div className="step-section-label">API 执行详情</div>
                      <div className="api-links-list">
                        {stepApiLinks.map(link => {
                          const key = cacheKey(link);
                          const cached = apiLinkDetails[key];
                          const isLinkExpanded = expandedStep === key;
                          return (
                            <div key={link.id} className="api-link-item">
                              <div
                                className="api-link-header"
                                onClick={() => {
                                  if (!cached?.detail && !cached?.loading) {
                                    fetchApiLinkDetail(link, logData.api_id as number);
                                  }
                                  setExpandedStep(isLinkExpanded ? null : key);
                                }}
                              >
                                <span>API #{link.api_execution_id}</span>
                                {link.param_row_index >= 0 && <span> 行{link.param_row_index + 1}</span>}
                                <span className="step-toggle">{isLinkExpanded ? '收起' : '展开'}</span>
                              </div>
                              {isLinkExpanded && (
                                <div className="api-link-detail">
                                  {cached?.loading && <div className="api-link-loading">加载中...</div>}
                                  {cached?.detail && (
                                    <div className="api-exec-steps">
                                      {cached.detail.steps.map(apiStep => {
                                        const stepLogData = tryParseJson(apiStep.log_data);
                                        return (
                                          <div key={apiStep.id} className={`api-exec-step ${API_STEP_CLASS[apiStep.log_type] || ''}`}>
                                            <div className="api-step-header">
                                              <span className={`step-type-badge ${API_STEP_CLASS[apiStep.log_type] || ''}`}>
                                                {API_STEP_LABELS[apiStep.log_type] || apiStep.log_type}
                                              </span>
                                            </div>
                                            {stepLogData && (
                                              <div className="api-step-detail">
                                                {stepLogData.status && (
                                                  <div className="step-section">
                                                    <div className="step-section-label">状态</div>
                                                    <span className={`scenario-log-status scenario-log-${stepLogData.status}`}>{statusLabel(String(stepLogData.status))}</span>
                                                  </div>
                                                )}
                                                {stepLogData.duration_ms != null && (
                                                  <div className="step-section">
                                                    <div className="step-section-label">耗时</div>
                                                    <span>{Number(stepLogData.duration_ms)} ms</span>
                                                  </div>
                                                )}
                                                {stepLogData.error && (
                                                  <div className="step-section">
                                                    <div className="step-section-label" style={{ color: '#e53e3e' }}>错误</div>
                                                    <div className="step-error-msg">{String(stepLogData.error)}</div>
                                                  </div>
                                                )}
                                                {stepLogData.assert_type && (
                                                  <div className="step-section">
                                                    <div className="step-section-label">断言类型</div>
                                                    <span>{String(stepLogData.assert_type)}</span>
                                                  </div>
                                                )}
                                                {stepLogData.assert_rule && (
                                                  <div className="step-section">
                                                    <div className="step-section-label">断言规则</div>
                                                    <div className="step-code">{String(stepLogData.assert_rule)}</div>
                                                  </div>
                                                )}
                                                {stepLogData.assert_result !== undefined && (
                                                  <div className="step-section">
                                                    <div className="step-section-label">断言结果</div>
                                                    <span className={stepLogData.assert_result ? 'scenario-exec-true' : 'scenario-exec-false'}>
                                                      {stepLogData.assert_result ? '通过' : '失败'}
                                                    </span>
                                                  </div>
                                                )}
                                                {stepLogData.actual !== undefined && (
                                                  <div className="step-section">
                                                    <div className="step-section-label">实际值</div>
                                                    <div className="step-code">{String(stepLogData.actual)}</div>
                                                  </div>
                                                )}
                                                {stepLogData.expected !== undefined && (
                                                  <div className="step-section">
                                                    <div className="step-section-label">期望值</div>
                                                    <div className="step-code">{String(stepLogData.expected)}</div>
                                                  </div>
                                                )}
                                                {stepLogData.extracted_vars && (
                                                  <div className="step-section">
                                                    <div className="step-section-label">提取变量</div>
                                                    <div className="step-code">{JSON.stringify(stepLogData.extracted_vars, null, 2)}</div>
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
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