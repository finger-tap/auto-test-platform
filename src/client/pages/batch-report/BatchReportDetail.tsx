import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import './BatchReportDetail.css';

interface AssertionResult {
  rule: { key: string; source: string; operator: string; expected_value?: string; assert: boolean };
  passed: boolean;
  actual: string;
}

interface NodeResult {
  node_id: string;
  node_type: string;
  node_name: string;
  status: string;
  duration_ms?: number;
  extract_values?: Record<string, any>;
  assertion_results?: AssertionResult[];
  logs?: Array<{ type: 'extract' | 'assert'; source: string; key: string; operator?: string; expected?: string; actual: string; passed: boolean; node_name?: string }>;
  error_message?: string;
  condition_result?: boolean;
  status_code?: number;
  request_headers?: Record<string, string>;
  request_body?: string;
  response_headers?: Record<string, string>;
  response_body?: string;
}

interface ScenarioResult {
  scenario_id: number;
  scenario_name: string;
  status: string;
  duration_ms: number | null;
  error_message?: string | null;
  node_summary?: { passed: number; failed: number; total: number };
  node_results?: Record<string, any>;
}

interface BatchReportDetail {
  id: number;
  set_id: number;
  set_name: string;
  passed: number;
  failed: number;
  total_duration_ms: number;
  executed_by: string;
  executed_at: string;
  scenarios: ScenarioResult[];
}

export default function BatchReportDetail({ testType = 'api' }: { testType?: string }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState<BatchReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedScenarioIdx, setSelectedScenarioIdx] = useState(0);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    apiFetch<BatchReportDetail>(`/batch-reports/${id}?test_type=${testType}`).then(res => {
      if (res.code === 200 && res.data) {
        setReport(res.data);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="brd-loading">加载中...</div>;
  if (!report) return <div className="brd-empty">报告不存在</div>;

  const selectedScenario = report.scenarios[selectedScenarioIdx];
  const total = report.passed + report.failed;
  const passRate = total > 0 ? Math.round((report.passed / total) * 100) : 0;

  const parseNodeResults = (scenario: ScenarioResult): Record<string, any> => {
    if (scenario.node_results && typeof scenario.node_results === 'object') {
      return scenario.node_results;
    }
    if (scenario.node_results && typeof scenario.node_results === 'string') {
      try { return JSON.parse(scenario.node_results); } catch { /* fall through */ }
    }
    return {};
  };

  const nodeResults = selectedScenario ? parseNodeResults(selectedScenario) : {};
  const nodeEntries = Object.entries(nodeResults).filter(([, v]) => v && typeof v === 'object');

  // Export as HTML
  const handleExport = () => {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>批量测试报告 - ${report.set_name}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#333}
  h1{font-size:22px;border-bottom:2px solid #1677ff;padding-bottom:10px;margin-bottom:20px}
  .summary{display:flex;gap:24px;margin-bottom:30px;background:#f5f7fa;padding:16px 20px;border-radius:8px}
  .summary-item{display:flex;flex-direction:column}
  .summary-label{font-size:12px;color:#888;margin-bottom:4px}
  .summary-value{font-size:20px;font-weight:600}
  .scenario{margin-bottom:24px;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden}
  .scenario-header{background:#fafafa;padding:12px 16px;border-bottom:1px solid #e8e8e8;font-weight:500;display:flex;align-items:center;gap:8px}
  .scenario-name{font-size:14px;color:#1a1a1a}
  .scenario-status{margin-left:auto;font-size:12px;padding:2px 8px;border-radius:4px;font-weight:400}
  .status-success{background:#f6ffed;color:#52c41a;border:1px solid #b7eb8f}
  .status-failed{background:#fff1f0;color:#ff4d4f;border:1px solid #ffccc7}
  .node-list{padding:12px 16px}
  .node-item{border:1px solid #f0f0f0;border-radius:6px;margin-bottom:8px;overflow:hidden}
  .node-header{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fafafa;border-bottom:1px solid #f0f0f0}
  .node-icon{font-size:16px}
  .node-name{font-size:13px;color:#1a1a1a}
  .node-status{margin-left:auto;font-size:12px;padding:1px 8px;border-radius:4px}
  .node-dur{font-size:12px;color:#888;margin-left:8px}
  .node-body{padding:10px 12px;font-size:13px}
  .extract-values{margin-bottom:8px}
  .extract-title{font-size:12px;color:#888;margin-bottom:4px}
  .extract-item{background:#f5f7fa;padding:4px 10px;border-radius:4px;display:inline-block;margin:2px;font-size:12px;color:#333}
  .assert-results{margin-top:4px}
  .assert-item{padding:4px 0;border-bottom:1px dashed #f0f0f0;display:flex;align-items:center;gap:6px;font-size:12px}
  .assert-pass{color:#52c41a;font-weight:600}
  .assert-fail{color:#ff4d4f;font-weight:600}
  .assert-expr{color:#555}
  .assert-actual{color:#888;font-size:11px;margin-left:4px}
  .node-error{color:#ff4d4f;font-size:13px;padding:6px 0}
  .empty{text-align:center;padding:40px;color:#999;font-size:14px}
  table{width:100%;border-collapse:collapse}
  th{background:#fafafa;text-align:left;padding:10px 12px;font-size:13px;color:#666;font-weight:500}
  td{padding:10px 12px;font-size:13px;border-bottom:1px solid #f5f5f5}
  tr:hover{background:#fafafa}
</style>
</head>
<body>
<h1>批量测试报告 — ${report.set_name}</h1>
<div class="summary">
  <div class="summary-item"><span class="summary-label">执行时间</span><span class="summary-value">${formatDateTime(report.executed_at)}</span></div>
  <div class="summary-item"><span class="summary-label">执行人</span><span class="summary-value">${report.executed_by}</span></div>
  <div class="summary-item"><span class="summary-label">通过</span><span class="summary-value" style="color:#52c41a">${report.passed}</span></div>
  <div class="summary-item"><span class="summary-label">失败</span><span class="summary-value" style="color:#ff4d4f">${report.failed}</span></div>
  <div class="summary-item"><span class="summary-label">通过率</span><span class="summary-value">${passRate}%</span></div>
  <div class="summary-item"><span class="summary-label">总耗时</span><span class="summary-value">${report.total_duration_ms} ms</span></div>
</div>
<h2 style="font-size:16px;margin-bottom:12px">场景明细</h2>
${report.scenarios.map((s, si) => `
<div class="scenario">
  <div class="scenario-header">
    <span class="scenario-name">${si + 1}. ${s.scenario_name}</span>
    <span class="scenario-status ${s.status === 'success' ? 'status-success' : 'status-failed'}">${s.status === 'success' ? '通过' : s.status === 'skipped' ? '跳过' : '失败'}</span>
    ${s.duration_ms != null ? `<span style="font-size:12px;color:#888">${s.duration_ms} ms</span>` : ''}
    ${s.node_summary ? `<span style="font-size:12px;color:#888">节点 ${s.node_summary.passed}/${s.node_summary.total}</span>` : ''}
  </div>
  ${(() => {
    const nrsObj: Record<string, any> = s.node_results ? (typeof s.node_results === 'object' ? s.node_results : (() => { try { return JSON.parse(s.node_results); } catch { return {}; } })()) : {};
    const nrs = Object.entries(nrsObj).filter(([, v]) => v && typeof v === 'object') as [string, Record<string, any>][];
    if (nrs.length === 0) return '<div class="empty" style="padding:16px">无节点数据</div>';
    return `<div class="node-list">${nrs.map(([nodeId, nr]) => `
    <div class="node-item">
      <div class="node-header">
        <span class="node-icon">${nr.node_type === 'condition' ? '⚡' : nr.node_type === 'start' || nr.node_type === 'end' ? '●' : '►'}</span>
        <span class="node-name">${nr.node_name}</span>
        <span class="node-status ${nr.status === 'success' ? 'status-success' : 'status-failed'}">${nr.status === 'success' ? '通过' : nr.status === 'skipped' ? '跳过' : '失败'}</span>
        ${nr.duration_ms ? `<span class="node-dur">${nr.duration_ms} ms</span>` : ''}
      </div>
      <div class="node-body">
        ${nr.node_type === 'condition' && nr.condition_result !== undefined ? `<div style="font-size:12px;color:#555">条件结果: ${nr.condition_result ? 'true (满足)' : 'false (不满足)'}</div>` : ''}
        ${nr.error_message ? `<div class="node-error">错误: ${nr.error_message}</div>` : ''}
        ${nr.extract_values && Object.keys(nr.extract_values).length > 0 ? `<div class="extract-values"><div class="extract-title">提取变量</div>${Object.entries(nr.extract_values).map(([k, v]) => `<span class="extract-item">{${k}} → ${typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>`).join('')}</div>` : ''}
        ${nr.assertion_results && nr.assertion_results.length > 0 ? `<div class="assert-results">${nr.assertion_results.map((ar: Record<string, any>) => `<div class="assert-item"><span class="${ar.passed ? 'assert-pass' : 'assert-fail'}">${ar.passed ? '✓ 通过' : '✗ 失败'}</span><span class="assert-expr">${ar.rule.key} (${ar.rule.source}) ${ar.rule.operator} ${ar.rule.expected_value || ''}</span><span class="assert-actual">实际: ${ar.actual}</span></div>`).join('')}</div>` : ''}
      </div>
    </div>`).join('')}</div>`;
  })()}
</div>`).join('')}
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch-report-${report.id}-${report.set_name}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusIcon = (status: string) => {
    if (status === 'success') return '✓';
    if (status === 'skipped') return '—';
    if (status === 'failed') return '✗';
    return '?';
  };

  return (
    <div className="brd-root">
      <div className="brd-head">
        <button className="brd-back" onClick={() => navigate('/api-test/batch-report')}>
          ← 返回列表
        </button>
        <h2>{report.set_name}</h2>
        <button className="brd-export" onClick={handleExport}>导出报告</button>
      </div>

      <div className="brd-summary">
        <div className="brd-summary-item">
          <span className="brd-summary-label">执行时间</span>
          <span className="brd-summary-value">{formatDateTime(report.executed_at)}</span>
        </div>
        <div className="brd-summary-item">
          <span className="brd-summary-label">执行人</span>
          <span className="brd-summary-value">{report.executed_by}</span>
        </div>
        <div className="brd-summary-item">
          <span className="brd-summary-label">通过</span>
          <span className="brd-summary-value" style={{ color: '#52c41a' }}>{report.passed}</span>
        </div>
        <div className="brd-summary-item">
          <span className="brd-summary-label">失败</span>
          <span className="brd-summary-value" style={{ color: '#ff4d4f' }}>{report.failed}</span>
        </div>
        <div className="brd-summary-item">
          <span className="brd-summary-label">通过率</span>
          <span className="brd-summary-value">{passRate}%</span>
        </div>
        <div className="brd-summary-item">
          <span className="brd-summary-label">总耗时</span>
          <span className="brd-summary-value">{report.total_duration_ms} ms</span>
        </div>
      </div>

      <div className="brd-content">
        {/* Left: scenario list */}
        <div className="brd-scenario-list">
          <div className="brd-sc-title">场景明细 ({report.scenarios.length})</div>
          {report.scenarios.map((s, i) => (
            <div
              key={i}
              className={`brd-sc-item ${selectedScenarioIdx === i ? 'brd-sc-selected' : ''}`}
              onClick={() => setSelectedScenarioIdx(i)}
            >
              <div className="brd-sc-row">
                <span className={`brd-sc-icon ${s.status}`}>{getStatusIcon(s.status)}</span>
                <span className="brd-sc-name">{s.scenario_name}</span>
                {s.duration_ms != null && <span className="brd-sc-dur">{s.duration_ms}ms</span>}
              </div>
              {s.node_summary && (
                <div className="brd-sc-nodes">
                  节点 {s.node_summary.passed}/{s.node_summary.total}
                </div>
              )}
              {s.error_message && (
                <div className="brd-sc-error">{s.error_message}</div>
              )}
            </div>
          ))}
        </div>

        {/* Right: node detail */}
        <div className="brd-node-detail">
          {selectedScenario ? (
            <>
              <div className="brd-detail-title">
                <span>{selectedScenario.scenario_name}</span>
                <span className={`brd-detail-status ${selectedScenario.status}`}>
                  {selectedScenario.status === 'success' ? '通过' : selectedScenario.status === 'skipped' ? '跳过' : '失败'}
                </span>
              </div>
              {Object.keys(nodeResults).length === 0 ? (
                <div className="brd-empty">无节点执行数据</div>
              ) : (
                <div className="brd-nodes">
                  {Object.entries(nodeResults).filter(([, v]: [string, any]) => v && typeof v === 'object').map(([nodeId, nr]: [string, any]) => {
                    const node = nr;
                    return (
                    <div key={nodeId} className={`brd-node-card brd-node-${node.status}`}>
                      <div className="brd-node-header">
                        <span className="brd-node-icon">
                          {nr.node_type === 'condition' ? '⚡' : nr.node_type === 'start' || nr.node_type === 'end' ? '●' : '►'}
                        </span>
                        <span className="brd-node-name">{nr.node_name}</span>
                        <span className={`brd-node-badge ${nr.status}`}>
                          {nr.status === 'success' ? '通过' : nr.status === 'skipped' ? '跳过' : '失败'}
                        </span>
                        {nr.duration_ms != null && <span className="brd-node-dur">{nr.duration_ms} ms</span>}
                      </div>

                      {nr.node_type === 'condition' && nr.condition_result !== undefined && (
                        <div className="brd-node-row">
                          <span className="brd-node-label">条件结果</span>
                          <span className={`brd-cond-result ${nr.condition_result ? 'cond-true' : 'cond-false'}`}>
                            {nr.condition_result ? 'true — 满足' : 'false — 不满足'}
                          </span>
                        </div>
                      )}

                      {nr.status_code && (
                        <div className="brd-node-row">
                          <span className="brd-node-label">状态码</span>
                          <span className={`brd-status-code ${nr.status_code >= 400 ? 'code-err' : 'code-ok'}`}>{nr.status_code}</span>
                        </div>
                      )}

                      {nr.request_headers && Object.keys(nr.request_headers).length > 0 && (
                        <div className="brd-node-row">
                          <span className="brd-node-label">请求头</span>
                          <div className="brd-header-list">
                            {Object.entries(nr.request_headers as Record<string, string>).map(([k, v]) => (
                              <div key={k} className="brd-header-item">
                                <span className="brd-header-key">{k}</span>
                                <span className="brd-header-arrow">:</span>
                                <span className="brd-header-val">{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {nr.request_body && (
                        <div className="brd-node-row">
                          <span className="brd-node-label">请求报文</span>
                          <pre className="brd-request-body">
                            {nr.request_body.length > 500 ? nr.request_body.slice(0, 500) + '...' : nr.request_body}
                          </pre>
                        </div>
                      )}

                      {nr.response_headers && Object.keys(nr.response_headers).length > 0 && (
                        <div className="brd-node-row">
                          <span className="brd-node-label">响应头</span>
                          <div className="brd-header-list">
                            {Object.entries(nr.response_headers as Record<string, string>).map(([k, v]) => (
                              <div key={k} className="brd-header-item">
                                <span className="brd-header-key">{k}</span>
                                <span className="brd-header-arrow">:</span>
                                <span className="brd-header-val">{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {nr.error_message && (
                        <div className="brd-node-error">错误: {nr.error_message}</div>
                      )}

                      {nr.extract_values && Object.keys(nr.extract_values).length > 0 && (
                        <div className="brd-node-row">
                          <span className="brd-node-label">提取变量</span>
                          <div className="brd-extract-list">
                            {Object.entries(nr.extract_values).map(([k, v]) => (
                              <div key={k} className="brd-extract-item">
                                <span className="brd-extract-key">{`{${k}}`}</span>
                                <span className="brd-extract-arrow">→</span>
                                <span className="brd-extract-val">
                                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {nr.assertion_results && nr.assertion_results.length > 0 && (
                        <div className="brd-node-row">
                          <span className="brd-node-label">断言结果 ({nr.assertion_results.length})</span>
                          <div className="brd-assert-list">
                            {nr.assertion_results.map((ar: Record<string, any>, ai: number) => (
                              <div key={ai} className={`brd-assert-item ${ar.passed ? 'assert-pass' : 'assert-fail'}`}>
                                <span className="brd-assert-icon">{ar.passed ? '✓' : '✗'}</span>
                                <span className="brd-assert-expr">
                                  {ar.rule.key || '?'}
                                  <span className="brd-assert-meta"> ({ar.rule.source} {ar.rule.operator} {ar.rule.expected_value || '-'})</span>
                                </span>
                                <span className="brd-assert-actual">实际: {ar.actual}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {nr.logs && nr.logs.length > 0 && (
                        <div className="brd-node-row">
                          <span className="brd-node-label">执行日志 ({nr.logs.length})</span>
                          <div className="brd-logs-list">
                            {(nr.logs as Array<Record<string, any>>).map((log: Record<string, any>, i: number) => (
                              <div key={i} className={`brd-log-item ${log.type === 'extract' ? 'brd-log-extract' : ''} ${log.type === 'assert' && !log.passed ? 'brd-log-fail' : ''}`}>
                                <span className="brd-log-icon">{log.type === 'extract' ? '↓' : (log.passed ? '✓' : '✗')}</span>
                                <span className="brd-log-type">{log.type === 'extract' ? '提取' : '断言'}</span>
                                <span className="brd-log-source">{log.source}.{log.key}</span>
                                {log.type === 'extract' && (
                                  <><span className="brd-log-arrow">→</span><span className="brd-log-actual">{log.actual || '(空)'}</span></>
                                )}
                                {log.type === 'assert' && (
                                  <>
                                    <span className="brd-log-check">{log.operator} {log.expected || ''}</span>
                                    <span className="brd-log-arrow">|</span>
                                    <span className="brd-log-actual">实际: {log.actual || '(空)'}</span>
                                    <span className={`brd-log-passed ${log.passed ? 'pass' : 'fail'}`}>{log.passed ? '✓' : '✗'}</span>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {nr.response_body && (
                        <div className="brd-node-row">
                          <span className="brd-node-label">响应预览</span>
                          <pre className="brd-response-body">
                            {nr.response_body.length > 500 ? nr.response_body.slice(0, 500) + '...' : nr.response_body}
                          </pre>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="brd-empty">请选择左侧场景查看节点详情</div>
          )}
        </div>
      </div>
    </div>
  );
}