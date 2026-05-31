/**
 * 全局通知工具 - 使用DOM注入，无需React组件
 * 在任何地方直接调用：notification.success('保存成功')
 */

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

interface NotificationOptions {
  type?: NotificationType;
  duration?: number;
}

// 通知容器单例
let container: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (!container) {
    container = document.createElement('div');
    container.className = 'notification-container';
    container.style.cssText = `
      position: fixed;
      top: 1.5rem;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }
  return container;
}

// 图标配置
const ICONS: Record<NotificationType, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'ℹ',
};

// 颜色配置
const COLORS: Record<NotificationType, string> = {
  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#6366f1',
};

// 默认时长（毫秒）
const DEFAULT_DURATION: Record<NotificationType, number> = {
  success: 2000,
  error: 4000,
  warning: 3000,
  info: 3000,
};

function createNotification(message: string, options: NotificationOptions = {}) {
  const { type = 'info', duration } = options;
  const resolvedDuration = duration ?? DEFAULT_DURATION[type];
  const container = getContainer();

  const toast = document.createElement('div');
  toast.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    background: ${COLORS[type]};
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    cursor: pointer;
    pointer-events: auto;
    animation: notificationSlideIn 0.2s ease;
    white-space: nowrap;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;
  `;
  toast.innerHTML = `
    <span style="font-size: 14px; font-weight: bold; flex-shrink: 0;">${ICONS[type]}</span>
    <span>${message}</span>
  `;

  // 点击关闭
  toast.addEventListener('click', () => removeToast(toast));

  // 自动消失
  const timer = setTimeout(() => removeToast(toast), resolvedDuration);

  // 动画移除
  function removeToast(el: HTMLElement) {
    clearTimeout(timer);
    el.style.animation = 'notificationFadeOut 0.25s ease forwards';
    setTimeout(() => el.remove(), 250);
  }

  container.appendChild(toast);
}

// 导出快捷方法
export const notification = {
  success: (message: string, options?: NotificationOptions) => createNotification(message, { type: 'success', ...options }),
  error: (message: string, options?: NotificationOptions) => createNotification(message, { type: 'error', ...options }),
  warning: (message: string, options?: NotificationOptions) => createNotification(message, { type: 'warning', ...options }),
  info: (message: string, options?: NotificationOptions) => createNotification(message, { type: 'info', ...options }),
  // 自定义
  show: (message: string, options?: NotificationOptions) => createNotification(message, options),
};

// 添加CSS动画（仅添加一次）
function injectStyles() {
  if (document.getElementById('notification-styles')) return;
  const style = document.createElement('style');
  style.id = 'notification-styles';
  style.textContent = `
    @keyframes notificationSlideIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes notificationFadeOut {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(-8px); }
    }
  `;
  document.head.appendChild(style);
}

// 初始化时注入动画样式
injectStyles();

export default notification;