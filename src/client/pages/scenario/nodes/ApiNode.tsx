import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ApiNodeConfig } from '../../../types';

function ApiNode({ data, selected }: NodeProps) {
  const config = data as unknown as ApiNodeConfig & { label?: string; executionStatus?: string };
  const apiName = config.api_name || '未选择接口';
  
  // 从 assertions 数组计算提取和断言数量
  // assert=true 的规则既是断言也是提取，assert=false 才是纯提取
  // 所以：提取数 = 总数，断言数 = assert=true 的数量
  const assertions = config.assertions || [];
  const extractCount = assertions.length;
  const assertionCount = assertions.filter((r: { assert?: boolean }) => r.assert === true).length;

  const statusClass = config.executionStatus ? `flow-node-${config.executionStatus}` : '';

  return (
    <div className={`flow-node flow-node-api ${selected ? 'flow-node-selected' : ''} ${statusClass}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flow-node-header">接口</div>
      <div className="flow-node-content">
        <div className="flow-node-api-name">{apiName}</div>
        <div className="flow-node-api-extract">
          {extractCount} 个提取、{assertionCount} 个断言
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(ApiNode);
