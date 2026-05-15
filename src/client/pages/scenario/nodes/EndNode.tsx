import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

function EndNode({ data }: NodeProps) {
  return (
    <div className="flow-node flow-node-end">
      <Handle type="target" position={Position.Top} />
      <div className="flow-node-label">{(data as { label?: string })?.label || '结束'}</div>
    </div>
  );
}

export default memo(EndNode);
