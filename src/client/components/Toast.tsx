import { useEffect, useRef, type ReactNode } from 'react';
import './Toast.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  open: boolean;
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: () => void;
}

export function Toast({ open, message, type = 'error', duration = 3000, onClose }: ToastProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(onClose, duration);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [open, duration, onClose]);

  if (!open) return null;

  return (
    <div className={`toast toast-${type}`} onClick={onClose}>
      {type === 'success' && <span className="toast-icon">✓</span>}
      {type === 'error' && <span className="toast-icon">✕</span>}
      {type === 'warning' && <span className="toast-icon">!</span>}
      {type === 'info' && <span className="toast-icon">ℹ</span>}
      <span>{message}</span>
    </div>
  );
}