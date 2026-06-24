import { useState, useMemo } from 'react';
import MidsceneReportViewer from '../MidsceneReportViewer';

export interface ExecRecord {
  id: number;
  time: string;
  status: 'success' | 'failed' | 'error' | 'running';
  duration: string;
  executor: string;
  passRate: string;
  reportUrl?: string | null;
  errorMessage?: string | null;
}

interface Props {
  latestReportUrl: string | null;
  execRecords: ExecRecord[];
  reportLabel?: string;
  pageSize?: number;
}

export default function LogTab({ latestReportUrl, execRecords, reportLabel = '最近一次执行的 Midscene 报告', pageSize = 6 }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(execRecords.length / pageSize));
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return execRecords.slice(start, start + pageSize);
  }, [execRecords, page, pageSize]);

  const activeReportUrl = selectedId != null
    ? execRecords.find(r => r.id === selectedId)?.reportUrl ?? latestReportUrl
    : latestReportUrl;

  const handleRowClick = (rec: ExecRecord) => {
    setSelectedId(rec.id);
    setExpandedId(rec.status === 'error' && rec.errorMessage
      ? (expandedId === rec.id ? null : rec.id)
      : null);
  };

  return (
    <div className="tab-content-wrapper tab-content-flush">
      <MidsceneReportViewer reportPath={activeReportUrl} label={reportLabel} />
      <div className="ad-section" style={{ flex: '0 0 auto' }}>
        <div className="ad-section-head">
          <label>执行记录</label>
          {execRecords.length > pageSize && (
            <span style={{ fontSize: 12, color: 'var(--fg-tertiary)' }}>
              共 {execRecords.length} 条
            </span>
          )}
        </div>
        {execRecords.length === 0 ? (
          <div className="api-empty" style={{ padding: '24px 0' }}>暂无执行记录</div>
        ) : (
          <>
            <table className="log-table">
              <thead>
                <tr>
                  <th>执行时间</th>
                  <th>状态</th>
                  <th>耗时</th>
                  <th>执行人</th>
                  <th>检查点通过率</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((rec) => (
                  <LogRow
                    key={rec.id}
                    rec={rec}
                    selected={selectedId === rec.id}
                    expanded={expandedId === rec.id}
                    onClick={() => handleRowClick(rec)}
                  />
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="log-pagination">
                <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
                <span className="log-pagination-info">{page} / {totalPages}</span>
                <button className="btn btn-sm btn-ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LogRow({ rec, selected, expanded, onClick }: { rec: ExecRecord; selected: boolean; expanded: boolean; onClick: () => void }) {
  const statusLabel = rec.status === 'success' ? '通过'
    : rec.status === 'failed' ? '失败'
    : rec.status === 'error' ? '异常'
    : '执行中';
  return (
    <>
      <tr
        className={`${selected ? 'log-row-selected' : ''} ${rec.status === 'error' ? 'log-row-error' : ''}`}
        style={{ cursor: 'pointer' }}
        onClick={onClick}
      >
        <td>{rec.time}</td>
        <td>
          <span className={`status-badge web-status-${rec.status}`}>
            {statusLabel}
          </span>
          {rec.status === 'error' && rec.errorMessage && (
            <span className="log-error-chevron" data-expanded={expanded}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M3 2l4 3-4 3z"/></svg>
            </span>
          )}
        </td>
        <td>{rec.duration}</td>
        <td>{rec.executor}</td>
        <td>
          <span className={rec.passRate.startsWith('3') ? 'assert-pass' : 'assert-fail'}>
            {rec.passRate}
          </span>
        </td>
      </tr>
      {expanded && rec.errorMessage && (
        <tr className="log-error-detail-row">
          <td colSpan={5}>
            <div className="log-error-detail">
              <svg className="log-error-detail-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.25"/><path d="M8 5v3.5M8 10.5v.5"/></svg>
              <span className="log-error-detail-text">{rec.errorMessage}</span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
