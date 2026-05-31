import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { toLocalDateTime } from '../../utils/datetime';
import type { BatchReport } from '../../types';
import FormSelect from '../../components/FormSelect';
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

export default function BatchReportList({ basePath = '/api-test', testType = 'api' }: { basePath?: string; testType?: string } = {}) {
  const navigate = useNavigate();
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

  // Filter
  const [fSetName, setFSetName] = useState('');
  const [fExecutedBy, setFExecutedBy] = useState('');
  const [fStatus, setFStatus] = useState<'all' | 'pass' | 'fail'>('all');

  const fetchReports = async (pageNum = 1, pageSz = pageSize) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: BatchReportItem[]; total: number; page: number; pageSize: number; totalPages: number }>(
        `/batch-reports?page=${pageNum}&pageSize=${pageSz}&test_type=${testType}`
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

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此报告？')) return;
    await apiFetch(`/batch-reports/${id}?test_type=${testType}`, { method: 'DELETE' });
    fetchReports(page, pageSize);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    fetchReports(newPage, pageSize);
  };

  const handlePageSizeChange = (newSize: number) => {
    fetchReports(1, newSize);
  };

  const filtered = reports.filter(r => {
    if (fSetName && !r.set_name.toLowerCase().includes(fSetName.toLowerCase())) return false;
    if (fExecutedBy && !r.executed_by.toLowerCase().includes(fExecutedBy.toLowerCase())) return false;
    if (fStatus === 'pass' && r.failed > 0) return false;
    if (fStatus === 'fail' && r.failed === 0) return false;
    return true;
  });

  if (loading && reports.length === 0) {
    return <div className="brl-loading">加载中...</div>;
  }

  return (
    <div className="brl-root">
      {/* Filter Area */}
      <div className="alist-filter">
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>场景集</label>
            <input placeholder="搜索场景集" value={fSetName} onChange={e => setFSetName(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>执行人</label>
            <input placeholder="搜索执行人" value={fExecutedBy} onChange={e => setFExecutedBy(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>结果</label>
            <FormSelect
              value={fStatus}
              options={[{ value: 'all', label: '全部' }, { value: 'pass', label: '全部通过' }, { value: 'fail', label: '有失败' }]}
              onChange={val => setFStatus(val as 'all' | 'pass' | 'fail')}
            />
          </div>
          <div className="alist-filter-actions">
            <button className="btn btn-default" onClick={() => { setFSetName(''); setFExecutedBy(''); setFStatus('all'); }}>重置</button>
          </div>
        </div>
      </div>

      {reports.length === 0 ? (
        <div className="brl-empty">
          <p>暂无批量执行记录</p>
          <p className="brl-empty-hint">在场景集页面执行批量测试后，记录将显示在此处</p>
        </div>
      ) : (
        <>
          <div className="alist-table-wrap">
            <table className="alist-table">
              <thead>
                <tr>
                  <th>场景集</th>
                  <th>执行时间</th>
                  <th>执行人</th>
                  <th>通过</th>
                  <th>失败</th>
                  <th>通过率</th>
                  <th>总耗时</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const total_ = r.passed + r.failed;
                  const rate = total_ > 0 ? Math.round((r.passed / total_) * 100) : 0;
                  return (
                    <>
                      <tr key={r.id} className={`brl-row ${r.failed > 0 ? 'brl-row-fail' : 'brl-row-pass'}`} onClick={() => navigate(`${basePath}/batch-report/${r.id}`)} style={{ cursor: 'pointer' }}>
                        <td className="brl-set-name">{r.set_name}</td>
                        <td className="brl-time">{toLocalDateTime(r.executed_at)}</td>
                        <td>{r.executed_by}</td>
                        <td className="brl-pass">{r.passed}</td>
                        <td className={r.failed > 0 ? 'brl-fail' : ''}>{r.failed}</td>
                        <td>
                          <span className={`brl-rate ${rate >= 80 ? 'rate-high' : rate >= 50 ? 'rate-mid' : 'rate-low'}`}>{rate}%</span>
                        </td>
                        <td>{r.total_duration_ms} ms</td>
                        <td>
                          <div className="row-actions">
                            <button className="row-action-btn" title="查看详情" onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/batch-report/${r.id}`); }}>👁</button>
                            <button className="row-action-btn row-action-del" title="删除" onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}>✕</button>
                          </div>
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
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="alist-pagination">
            <button
              className="btn btn-sm"
              disabled={page <= 1}
              onClick={() => handlePageChange(page - 1)}
            >上一页</button>
            <span className="page-info">{page} / {totalPages}</span>
            <button
              className="btn btn-sm"
              disabled={page >= totalPages}
              onClick={() => handlePageChange(page + 1)}
            >下一页</button>
            <FormSelect value={String(pageSize)} options={[{value:"10",label:"10条/页"},{value:"20",label:"20条/页"},{value:"50",label:"50条/页"},{value:"100",label:"100条/页"}]} onChange={val => handlePageSizeChange(Number(val))} />
          </div>
        </>
      )}

      {msgOpen && (
        <div className="sset-msg-toast" data-type={msgType} onClick={() => setMsgOpen(false)}>{msg}</div>
      )}
    </div>
  );
}