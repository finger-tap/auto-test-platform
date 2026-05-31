import { useState } from 'react';
import type { ApiExecution, ApiExecutionStep } from '../../types';
import ApiExecutionTimeline from '../../components/ApiExecutionTimeline';

interface Props {
  execution: ApiExecution;
  id: string;
  /** Initial active row index (for jumping to specific member) */
  defaultActiveRow?: number;
}

export default function BatchExecutionView({ execution, id, defaultActiveRow }: Props) {
  const [activeRow, setActiveRow] = useState(defaultActiveRow ?? 0);

  const allRows = [execution, ...(execution.sub_executions || [])].sort((a, b) => a.param_row_index - b.param_row_index);

  return (
    <div className="batch-exec-view">
      <div className="batch-exec-tabs">
        {allRows.map((row, idx) => (
          <button
            key={row.id}
            className={`batch-exec-tab ${activeRow === idx ? 'active' : ''}`}
            onClick={() => setActiveRow(idx)}
          >
            第{idx + 1}组{row.param_row_index >= 0 ? ` (行${row.param_row_index + 1})` : ''}
          </button>
        ))}
      </div>
      <div className="batch-exec-content">
        <ApiExecutionTimeline
          execution={allRows[activeRow]}
          steps={allRows[activeRow].steps || []}
          assertionResults={{ pre: [], main: [], post: [], final: [] }}
        />
      </div>
    </div>
  );
}