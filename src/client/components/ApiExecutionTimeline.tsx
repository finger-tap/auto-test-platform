import { useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import type { ApiExecutionStep, ApiExecution, AssertionResult } from '../../types';

const LOG_TYPE_LABELS: Record<string, string> = {
  start: '开始',
  pre_action: '前置动作',
  main_action: '主体动作',
  post_action: '后置动作',
  final_check: '最终检查',
  error: '错误',
  end: '完成',
};

const LOG_TYPE_CLASS: Record<string, string> = {
  start: 'step-start',
  pre_action: 'step-pre',
  main_action: 'step-main',
  post_action: 'step-post',
  final_check: 'step-final',
  error: 'step-error',
  end: 'step-end',
};

const ASSERTION_OP_LABEL: Record<string, string> = {
  equals: '等于', not_equals: '不等于', contains: '包含', not_contains: '不包含',
  less_than: '小于', greater_than: '大于', exists: '存在', not_exists: '不存在',
};

const statusLabel = (status: string) => {
  switch (status) {
    case 'success': return '成功';
    case 'failed': return '失败';
    case 'error': return '错误';
    default: return status;
  }
};

const tryParseJson = (text: string | null | Record<string, unknown>): Record<string, unknown> | null => {
  if (!text) return null;
  if (typeof text === 'object') return text;
  try { return JSON.parse(text); } catch { return null; }
};

const tryFormatJson = (text: string | null) => {
  if (!text) return '';
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
};

interface Props {
  execution: ApiExecution;
  steps: ApiExecutionStep[];
  assertionResults: {
    pre: AssertionResult[];
    main: AssertionResult[];
    post: AssertionResult[];
    final: AssertionResult[];
  };
}

export default function ApiExecutionTimeline({ execution, steps, assertionResults }: Props) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const stepDuration = (idx: number) => {
    if (idx >= steps.length - 1) return null;
    const cur = new Date(steps[idx].created_at).getTime();
    const next = new Date(steps[idx + 1].created_at).getTime();
    return next - cur;
  };

  const totalPassed = assertionResults.main.filter(r => r.passed).length;
  const totalFailed = assertionResults.main.filter(r => !r.passed).length;

  return (
    <div className="api-exec-timeline">
      <div className="api-exec-header">
        <div className="api-exec-status-row">
          <span className={`scenario-log-status scenario-log-${execution.status}`}>{statusLabel(execution.status)}</span>
          <span className="api-exec-code">{execution.status_code || '—'}</span>
          <span className="api-exec-duration">{execution.duration_ms != null ? `${execution.duration_ms} ms` : '—'}</span>
          {execution.param_row_index >= 0 && (
            <span className="param-badge">行 {execution.param_row_index + 1}</span>
          )}
        </div>
        {assertionResults.main.length > 0 && (
          <div className="api-exec-assert-summary">
            <span className={totalFailed === 0 ? 'assert-all-pass' : 'assert-has-fail'}>
              断言: {totalPassed} 通过, {totalFailed} 失败
            </span>
          </div>
        )}
      </div>

      <div className="api-exec-steps">
        {steps.map((step, idx) => {
          const isExpanded = expandedStep === step.id;
          const duration = stepDuration(idx);
          const logData = tryParseJson(step.log_data);

          return (
            <div key={step.id} className={`api-exec-step ${LOG_TYPE_CLASS[step.log_type] || ''}`}>
              <div className="step-indicator">
                <div className="step-dot" />
                {idx < steps.length - 1 && <div className="step-line" />}
              </div>

              <div className="step-content">
                <div className="step-header" onClick={() => setExpandedStep(isExpanded ? null : step.id)}>
                  <span className={`step-type-badge ${LOG_TYPE_CLASS[step.log_type] || ''}`}>
                    {LOG_TYPE_LABELS[step.log_type] || step.log_type}
                  </span>
                  <span className="step-name">{step.step_name || LOG_TYPE_LABELS[step.log_type]}</span>
                  {duration != null && <span className="step-duration">{duration}ms</span>}
                  <span className="step-toggle">{isExpanded ? '收起' : '展开'}</span>
                </div>

                <div className="step-log-text">{step.log_text}</div>

                {isExpanded && logData && (
                  <div className="step-detail">
                    {/* Assertions in this step */}
                    {logData.assertions && Array.isArray(logData.assertions as unknown[]) && (
                      <div className="step-section">
                        <div className="step-section-label">断言结果</div>
                        <div className="ad-assertion-results">
                          {((logData.assertions as unknown as AssertionResult[]).map((ar, i) => (
                            <div key={i} className={`ad-assertion-result ${ar.rule.assert === false ? 'extract-only' : ar.passed ? 'pass' : 'fail'}`}>
                              <span className="ad-ar-icon">{ar.rule.assert === false ? '⊘' : ar.passed ? '✓' : '✗'}</span>
                              <div className="ad-ar-detail">
                                {ar.rule.name && <div className="ad-ar-name">{ar.rule.name}</div>}
                                <div className="ad-ar-row">
                                  <span className="ad-ar-label">提取:</span>
                                  <span>{ar.rule.source}{ar.rule.key && ar.rule.source !== 'status' ? `.${ar.rule.key}` : ''}</span>
                                  <span className="ad-ar-label" style={{ marginLeft: 8 }}>实际值:</span>
                                  <span className="ad-ar-extract-val">{ar.actual || '(空)'}</span>
                                </div>
                                {ar.rule.assert !== false && (
                                  <div className="ad-ar-row">
                                    <span className="ad-ar-label">校验:</span>
                                    <span className="ad-ar-check-text">{ASSERTION_OP_LABEL[ar.rule.operator] || ar.rule.operator} {ar.rule.expected || ''}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )))}
                        </div>
                      </div>
                    )}

                    {/* Request/Response data */}
                    {logData.request_headers && (
                      <div className="step-section">
                        <div className="step-section-label">请求头</div>
                        <CodeMirror
                          value={tryFormatJson(JSON.stringify(logData.request_headers))}
                          height="auto" maxHeight="150px"
                          extensions={[json()]}
                          editable={false}
                          basicSetup={{ lineNumbers: false, foldGutter: false }}
                        />
                      </div>
                    )}
                    {logData.request_body && (
                      <div className="step-section">
                        <div className="step-section-label">请求体</div>
                        <CodeMirror
                          value={tryFormatJson(String(logData.request_body))}
                          height="auto" maxHeight="150px"
                          extensions={[json()]}
                          editable={false}
                          basicSetup={{ lineNumbers: false, foldGutter: false }}
                        />
                      </div>
                    )}
                    {logData.status_code && (
                      <div className="step-section">
                        <div className="step-section-label">响应状态</div>
                        <CodeMirror
                          value={JSON.stringify({ status_code: logData.status_code, duration_ms: logData.duration_ms }, null, 2)}
                          height="auto" maxHeight="100px"
                          extensions={[json()]}
                          editable={false}
                          basicSetup={{ lineNumbers: false, foldGutter: false }}
                        />
                      </div>
                    )}
                    {logData.response_body && (
                      <div className="step-section">
                        <div className="step-section-label">响应体</div>
                        <CodeMirror
                          value={tryFormatJson(String(logData.response_body))}
                          height="auto" maxHeight="200px"
                          extensions={[json()]}
                          editable={false}
                          basicSetup={{ lineNumbers: false, foldGutter: false }}
                        />
                      </div>
                    )}
                    {logData.script && (
                      <div className="step-section">
                        <div className="step-section-label">脚本内容</div>
                        <CodeMirror
                          value={String(logData.script)}
                          height="auto" maxHeight="150px"
                          extensions={[json()]}
                          editable={false}
                          basicSetup={{ lineNumbers: false, foldGutter: false }}
                        />
                      </div>
                    )}
                    {logData.error && (
                      <div className="step-section">
                        <div className="step-section-label" style={{ color: '#e53e3e' }}>错误</div>
                        <div className="step-error-msg">{String(logData.error)}</div>
                      </div>
                    )}
                    {logData.assertion_results && Array.isArray(logData.assertion_results) && logData.assertion_results.length > 0 && (
                      <div className="step-section">
                        <div className="step-section-label">动作规则 ({logData.assertion_results.length})</div>
                        <div className="ad-assertion-results">
                          {(logData.assertion_results as unknown as AssertionResult[]).map((ar, i) => {
                            const cls = (ar.rule.assert === false ? 'extract-only' : (ar.passed ? 'pass' : 'fail'));
                            return (
                              <div key={i} className={`ad-assertion-result ${cls}`}>
                                <span className="ad-ar-icon">{ar.rule.assert === false ? '⊘' : ar.passed ? '✓' : '✗'}</span>
                                <div className="ad-ar-detail">
                                  {ar.rule.name && <div className="ad-ar-name">{ar.rule.name}</div>}
                                  <div className="ad-ar-row">
                                    <span className="ad-ar-label">提取:</span>
                                    <span>{ar.rule.source}{ar.rule.key && ar.rule.source !== 'status' ? `.${ar.rule.key}` : ''}</span>
                                    <span className="ad-ar-label" style={{ marginLeft: 8 }}>实际值:</span>
                                    <span className="ad-ar-extract-val">{ar.actual || '(空)'}</span>
                                  </div>
                                  {ar.rule.assert !== false && (
                                    <div className="ad-ar-row">
                                      <span className="ad-ar-label">校验:</span>
                                      <span className="ad-ar-check-text">{ASSERTION_OP_LABEL[ar.rule.operator] || ar.rule.operator} {ar.rule.expected || ''}</span>
                                    </div>
                                  )}
                                </div>
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
    </div>
  );
}