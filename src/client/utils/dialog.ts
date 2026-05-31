import React from 'react';
import ReactDOM from 'react-dom';

interface ToastOptions {
  type?: 'success' | 'danger' | 'warning' | 'info';
  duration?: number;
}

let toastContainer: HTMLElement | null = null;

function getToastContainer(): HTMLElement {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(message: string, options: ToastOptions = {}) {
  const { type = 'info', duration = 3000 } = options;
  const container = getToastContainer();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-fadeout');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}

export function confirmDialog(
  message: string,
  onConfirm: () => void,
  onCancel?: () => void
) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  overlay.innerHTML = `
    <div class="modal modal-sm">
      <div class="modal-header">
        <div class="modal-title">确认操作</div>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body confirm-modal">${message}</div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm cancel-btn">取消</button>
        <button class="btn btn-primary btn-sm confirm-btn">确认</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    onCancel?.();
  };

  overlay.querySelector('.modal-close')?.addEventListener('click', close);
  overlay.querySelector('.cancel-btn')?.addEventListener('click', close);
  overlay.querySelector('.confirm-btn')?.addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}