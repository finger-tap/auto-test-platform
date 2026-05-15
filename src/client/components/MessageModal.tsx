import './MessageModal.css';

interface MessageModalProps {
  open: boolean;
  message: string;
  type?: 'error' | 'warning' | 'success';
  onClose: () => void;
}

export default function MessageModal({ open, message, type = 'error', onClose }: MessageModalProps) {
  if (!open) return null;

  return (
    <div className="msg-overlay" onClick={onClose}>
      <div className="msg-modal" onClick={(e) => e.stopPropagation()}>
        <div className={`msg-icon msg-icon-${type}`}>
          {type === 'error' ? '✕' : type === 'warning' ? '!' : '✓'}
        </div>
        <div className="msg-content">{message}</div>
        <button className="msg-btn" onClick={onClose}>知道了</button>
      </div>
    </div>
  );
}