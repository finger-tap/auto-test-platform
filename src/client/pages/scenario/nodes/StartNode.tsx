import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

function StartNode({ data }: NodeProps) {
  return (
    <div className="flow-node flow-node-start">
      <div className="flow-node-label">{(data as { label?: string })?.label || '开始'}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(StartNode);
