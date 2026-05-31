import { useState, useEffect, useRef, type ReactNode } from 'react';
import './ConfirmDialog.css';

interface ConfirmDialogProps {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, message, onConfirm, onCancel }: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        <div className="confirm-icon">?</div>
        <div className="confirm-message">{message}</div>
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn-cancel" onClick={onCancel}>取消</button>
          <button className="confirm-btn confirm-btn-ok" onClick={onConfirm}>确定</button>
        </div>
      </div>
    </div>
  );
}

/** 全局 confirm 替代，调用方式不变（返回 Promise） */
export function confirm(message: string): Promise<boolean> {
  return new Promise(resolve => {
    const container = document.createElement('div');
    container.id = 'global-confirm-root';
    document.body.appendChild(container);

    const close = (result: boolean) => {
      ReactDOM.createRoot(container).unmount();
      document.body.removeChild(container);
      resolve(result);
    };

    const el = (
      <ConfirmDialog
        open={true}
        message={message}
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
      />
    );
    ReactDOM.createRoot(container).render(el);
  });
}

// 需要在文件顶部 import ReactDOM from 'react-dom'
import ReactDOM from 'react-dom';