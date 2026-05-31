import { useState } from 'react';
import type { ScenarioExecution } from '../../types';
import ScenarioExecutionTimeline from '../../components/ScenarioExecutionTimeline';

interface Props {
  execution: ScenarioExecution;
}

export default function ScenarioBatchExecutionView({ execution }: Props) {
  const [activeRow, setActiveRow] = useState(0);

  // leader is group 1, sub_executions are group 2, 3, etc.
  const allRows = [execution, ...(execution.sub_executions || [])];

  return (
    <div className="batch-exec-view">
      <div className="batch-exec-tabs">
        {allRows.map((row, idx) => (
          <button
            key={row.id}
            className={`batch-exec-tab ${activeRow === idx ? 'active' : ''}`}
            onClick={() => setActiveRow(idx)}
          >
            第{idx + 1}组
          </button>
        ))}
      </div>
      <div className="batch-exec-content">
        {allRows[activeRow]?.steps && allRows[activeRow].steps!.length > 0 ? (
          <ScenarioExecutionTimeline
            steps={allRows[activeRow].steps || []}
            apiLinks={allRows[activeRow].api_links || []}
          />
        ) : (
          <div style={{ padding: '16px', color: '#999', textAlign: 'center' }}>无执行记录</div>
        )}
      </div>
    </div>
  );
}