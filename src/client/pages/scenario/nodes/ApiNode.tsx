import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ApiNodeConfig } from '../../../types';

function ApiNode({ data, selected }: NodeProps) {
  const config = data as unknown as ApiNodeConfig & { label?: string; executionStatus?: string };
  const apiName = config.api_name || '未选择接口';
  const extractCount = config.extract_rules?.length || 0;

  const statusClass = config.executionStatus ? `flow-node-${config.executionStatus}` : '';

  return (
    <div className={`flow-node flow-node-api ${selected ? 'flow-node-selected' : ''} ${statusClass}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flow-node-header">接口</div>
      <div className="flow-node-content">
        <div className="flow-node-api-name">{apiName}</div>
        {extractCount > 0 && (
          <div className="flow-node-api-extract">
            提取 {extractCount} 个参数
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(ApiNode);
