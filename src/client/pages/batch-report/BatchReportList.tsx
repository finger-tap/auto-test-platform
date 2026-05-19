import { useState, useEffect, Fragment } from 'react';
import { apiFetch } from '../../utils/api';
import './BatchReportList.css';

interface ScenarioResult {
  scenario_id: number;
  scenario_name: string;
  status: string;
  duration_ms: number | null;
  error_message?: string | null;
  node_summary?: { passed: number; failed: number; total: number };
}

interface BatchReportItem {
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

export default function BatchReportList() {
  const [reports, setReports] = useState<BatchReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [msgOpen, setMsgOpen] = useState(false);

  const fetchReports = async (pageNum = 1, pageSz = pageSize) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: BatchReportItem[]; total: number; page: number; pageSize: number; totalPages: number }>(
        `/batch-reports?page=${pageNum}&pageSize=${pageSz}`
      );
      if (res.code === 200 && res.data) {
        setReports(res.data.items);
        setTotal(res.data.total);
        setPage(res.data.page);
        setPageSize(res.data.pageSize);
        setTotalPages(res.data.totalPages);
      }
    } catch {
      setMsg('加载失败'); setMsgType('error'); setMsgOpen(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReports(); }, []);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    fetchReports(newPage, pageSize);
  };

  const handlePageSizeChange = (newSize: number) => {
    fetchReports(1, newSize);
  };

  if (loading && reports.length === 0) {
    return <div className="brl-loading">加载中...</div>;
  }

  return (
    <div className="brl-root">
      <div className="brl-head">
        <h2>批量报告</h2>
        <span className="brl-count">共 {total} 条</span>
      </div>

      {reports.length === 0 ? (
        <div className="brl-empty">
          <p>暂无批量执行记录</p>
          <p className="brl-empty-hint">在场景集页面执行批量测试后，记录将显示在此处</p>
        </div>
      ) : (
        <>
          <table className="brl-table">
            <thead>
              <tr>
                <th>场景集</th>
                <th>执行时间</th>
                <th>执行人</th>
                <th>通过</th>
                <th>失败</th>
                <th>通过率</th>
                <th>总耗时</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const total_ = r.passed + r.failed;
                const rate = total_ > 0 ? Math.round((r.passed / total_) * 100) : 0;
                return (
                  <Fragment key={r.id}>
                    <tr key={r.id} className={`brl-row ${r.failed > 0 ? 'brl-row-fail' : 'brl-row-pass'}`}>
                      <td className="brl-set-name">{r.set_name}</td>
                      <td className="brl-time">{r.executed_at.replace('T', ' ').slice(0, 19)}</td>
                      <td>{r.executed_by}</td>
                      <td className="brl-pass">{r.passed}</td>
                      <td className={r.failed > 0 ? 'brl-fail' : ''}>{r.failed}</td>
                      <td>
                        <span className={`brl-rate ${rate >= 80 ? 'rate-high' : rate >= 50 ? 'rate-mid' : 'rate-low'}`}>{rate}%</span>
                      </td>
                      <td>{r.total_duration_ms} ms</td>
                      <td>
                        <button
                          className="brl-toggle"
                          onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                        >
                          {expandedId === r.id ? '收起' : '展开'}
                        </button>
                      </td>
                    </tr>
                    {expandedId === r.id && (
                      <tr key={`${r.id}-detail`} className="brl-detail-row">
                        <td colSpan={8}>
                          <div className="brl-detail">
                            <div className="brl-detail-head">场景明细</div>
                            {r.scenarios.length === 0 ? (
                              <div className="brl-scenario-empty">无场景数据</div>
                            ) : (
                              <div className="brl-scenario-list">
                                {r.scenarios.map((s, i) => (
                                  <div key={i} className={`brl-scenario-item brl-sc-${s.status}`}>
                                    <span className="brl-sc-icon">
                                      {s.status === 'success' ? '✓' : s.status === 'skipped' ? '—' : '✗'}
                                    </span>
                                    <span className="brl-sc-name">{s.scenario_name}</span>
                                    {s.duration_ms != null && (
                                      <span className="brl-sc-dur">{s.duration_ms} ms</span>
                                    )}
                                    {s.node_summary && (
                                      <span className="brl-sc-nodes">
                                        {s.node_summary.passed}/{s.node_summary.total}
                                      </span>
                                    )}
                                    {s.error_message && (
                                      <span className="brl-sc-error">{s.error_message}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="alist-pagination">
            <button
              className="page-btn"
              disabled={page <= 1}
              onClick={() => handlePageChange(page - 1)}
            >上一页</button>
            <span className="page-info">{page} / {totalPages}</span>
            <button
              className="page-btn"
              disabled={page >= totalPages}
              onClick={() => handlePageChange(page + 1)}
            >下一页</button>
            <select
              className="page-size-select"
              value={pageSize}
              onChange={e => handlePageSizeChange(Number(e.target.value))}
            >
              <option value={10}>10条/页</option>
              <option value={20}>20条/页</option>
              <option value={50}>50条/页</option>
              <option value={100}>100条/页</option>
            </select>
          </div>
        </>
      )}

      {msgOpen && (
        <div className="sset-msg-toast" data-type={msgType} onClick={() => setMsgOpen(false)}>{msg}</div>
      )}
    </div>
  );
}