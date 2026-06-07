import MidsceneReportViewer from '../MidsceneReportViewer';

export interface ExecRecord {
  id: number;
  time: string;
  status: 'success' | 'failed' | 'running';
  duration: string;
  executor: string;
  passRate: string;
}

interface Props {
  latestReportUrl: string | null;
  execRecords: ExecRecord[];
  reportLabel?: string;
}

export default function LogTab({ latestReportUrl, execRecords, reportLabel = '最近一次执行的 Midscene 报告' }: Props) {
  return (
    <div className="tab-content-wrapper">
      <MidsceneReportViewer reportPath={latestReportUrl} label={reportLabel} />
      <div className="ad-section">
        <div className="ad-section-head">
          <label>执行记录</label>
        </div>
        {execRecords.length === 0 ? (
          <div className="api-empty" style={{ padding: '24px 0' }}>暂无执行记录</div>
        ) : (
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
              {execRecords.map((rec) => (
                <tr key={rec.id}>
                  <td>{rec.time}</td>
                  <td>
                    <span className={`status-badge web-status-${rec.status}`}>
                      {rec.status === 'success' ? '通过' : rec.status === 'failed' ? '失败' : '执行中'}
                    </span>
                  </td>
                  <td>{rec.duration}</td>
                  <td>{rec.executor}</td>
                  <td>
                    <span className={rec.passRate.startsWith('3') ? 'assert-pass' : 'assert-fail'}>
                      {rec.passRate}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
