import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ConditionNodeConfig } from '../../../types';

function ConditionNode({ data, selected }: NodeProps) {
  const config = data as unknown as ConditionNodeConfig & { label?: string; executionStatus?: string; conditionResult?: boolean };
  const expr = config.condition_expr || '未配置条件';

  const statusClass = config.executionStatus ? `flow-node-${config.executionStatus}` : '';

  return (
    <div className={`flow-node flow-node-condition ${selected ? 'flow-node-selected' : ''} ${statusClass}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flow-node-header">条件</div>
      <div className="flow-node-content">
        <div className="flow-node-condition-expr" title={expr}>
          {expr.length > 30 ? expr.slice(0, 30) + '...' : expr}
        </div>
      </div>
      <div className="flow-node-condition-handles">
        <div className="flow-node-condition-branch flow-node-condition-true">
          <span>T</span>
          <Handle type="source" position={Position.Bottom} id="true" style={{ left: '30%' }} />
        </div>
        <div className="flow-node-condition-branch flow-node-condition-false">
          <span>F</span>
          <Handle type="source" position={Position.Bottom} id="false" style={{ left: '70%' }} />
        </div>
      </div>
    </div>
  );
}

export default memo(ConditionNode);
