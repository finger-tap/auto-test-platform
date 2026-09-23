/**
 * 全局通知工具 - 使用DOM注入，无需React组件
 * 在任何地方直接调用：notification.success('保存成功')
 * 确认弹窗：const ok = await notification.confirm('确认删除？')
 */

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

interface NotificationOptions {
  type?: NotificationType;
  duration?: number;
}

interface ConfirmOptions {
  title?: string;
  type?: 'warning' | 'danger';
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
      /* 连续报错时 toast 堆叠会超出视口 — 限高滚动 */
      max-height: calc(100vh - 6rem);
      overflow-y: auto;
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
// 2026-08-27: 错误/警告信息往往比较长(服务端回显、校验明细), 3-4 秒一闪而过
// 用户来不及读 — error 提到 10s、warning 6s; 且下方支持悬停暂停与手动关闭。
const DEFAULT_DURATION: Record<NotificationType, number> = {
  success: 2000,
  error: 10000,
  warning: 6000,
  info: 3000,
};

function createNotification(message: string, options: NotificationOptions = {}) {
  const { type = 'info', duration } = options;
  const resolvedDuration = duration ?? DEFAULT_DURATION[type];
  const container = getContainer();

  const toast = document.createElement('div');
  toast.style.cssText = `
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px 10px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    background: ${COLORS[type]};
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    cursor: pointer;
    pointer-events: auto;
    animation: notificationSlideIn 0.2s ease;
    /* 长错误信息(服务端回显/校验明细)折行显示而不是横向溢出 */
    white-space: normal;
    word-break: break-word;
    max-width: min(560px, calc(100vw - 4rem));
    line-height: 1.5;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;
  `;
  // icon 是内部常量可安全 innerHTML; message 走 textContent — 它常携带
  // 用户可控文本(资源名/服务端回显), 拼进 innerHTML 是存储型 XSS
  const icon = document.createElement('span');
  icon.style.cssText = 'font-size: 14px; font-weight: bold; flex-shrink: 0; line-height: 1.5;';
  icon.innerHTML = ICONS[type];
  const text = document.createElement('span');
  text.textContent = message;
  text.style.cssText = 'flex: 1; min-width: 0;';
  toast.appendChild(icon);
  toast.appendChild(text);

  // 手动关闭按钮 — 错误信息不能只靠"等它消失"来摆脱
  const closeBtn = document.createElement('span');
  closeBtn.textContent = '×';
  closeBtn.title = '关闭';
  closeBtn.style.cssText = `
    flex-shrink: 0; margin-left: 4px; padding: 0 6px;
    font-size: 16px; line-height: 1.4; border-radius: 4px;
    opacity: 0.75; cursor: pointer;
  `;
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeToast(toast); });
  toast.appendChild(closeBtn);

  // 点击 toast 主体也可关闭
  toast.addEventListener('click', () => removeToast(toast));

  let removed = false;
  // 自动消失; 悬停暂停计时 — 阅读长错误时不会中途消失 (2026-08-27)
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => removeToast(toast), resolvedDuration);
  const pauseTimer = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  const resumeTimer = () => {
    if (!timer) timer = setTimeout(() => removeToast(toast), 4000);
  };
  toast.addEventListener('mouseenter', pauseTimer);
  toast.addEventListener('mouseleave', resumeTimer);

  // 动画移除
  function removeToast(el: HTMLElement) {
    pauseTimer();
    if (removed) return;
    removed = true;
    el.style.animation = 'notificationFadeOut 0.25s ease forwards';
    setTimeout(() => el.remove(), 250);
  }

  container.appendChild(toast);
}

/** 全局 confirm 替代，返回 Promise<boolean> */
function showConfirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const { title = '确认操作', type = 'warning' } = options;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ncf-overlay';

    const btnColor = type === 'danger' ? '#ef4444' : 'var(--accent, #6366f1)';

    // 模板中仅放内部常量; title/message 是用户可控文本, 用 textContent 填充防 XSS
    overlay.innerHTML = `
      <div class="ncf-dialog">
        <div class="ncf-header">
          <span class="ncf-icon ncf-icon-${type}">${type === 'danger' ? '✕' : '!'}</span>
          <span class="ncf-title"></span>
        </div>
        <div class="ncf-body"></div>
        <div class="ncf-actions">
          <button class="ncf-btn ncf-btn-cancel">取消</button>
          <button class="ncf-btn ncf-btn-ok" style="background:${btnColor}">确定</button>
        </div>
      </div>
    `;
    (overlay.querySelector('.ncf-title') as HTMLElement).textContent = title;
    (overlay.querySelector('.ncf-body') as HTMLElement).textContent = message;

    // let: 下方注册键盘监听后会包一层" settled 保护"(见注释), 预先注册的
    // 按钮/遮罩 handler 引用同一变量绑定, 调用时同样经过保护层
    let close = (result: boolean) => {
      overlay.classList.add('ncf-closing');
      setTimeout(() => {
        overlay.remove();
        resolve(result);
      }, 200);
    };

    overlay.querySelector('.ncf-btn-cancel')!.addEventListener('click', () => close(false));
    overlay.querySelector('.ncf-btn-ok')!.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });

    document.body.appendChild(overlay);

    // 聚焦确定按钮，支持 Enter/Esc。
    // 2026-08-27: once:true 的监听在鼠标关闭后不会被消费, 残留到下一次任意
    // 按键时还会 preventDefault 吃掉一次默认行为; 且多弹窗叠开时会连坐
    // (一次按键触发所有对话框)。改为随 overlay 移除而注销, 且只作用于
    // 当前这个 overlay 尚未关闭的情况。
    const okBtn = overlay.querySelector('.ncf-btn-ok') as HTMLElement;
    okBtn.focus();
    let settled = false;
    const handleKey = (e: KeyboardEvent) => {
      if (settled) return;
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
    };
    document.addEventListener('keydown', handleKey);
    const origClose = close;
    close = (result: boolean) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', handleKey);
      origClose(result);
    };  });
}

// 导出快捷方法
export const notification = {
  success: (message: string, options?: NotificationOptions) => createNotification(message, { type: 'success', ...options }),
  error: (message: string, options?: NotificationOptions) => createNotification(message, { type: 'error', ...options }),
  warning: (message: string, options?: NotificationOptions) => createNotification(message, { type: 'warning', ...options }),
  info: (message: string, options?: NotificationOptions) => createNotification(message, { type: 'info', ...options }),
  show: (message: string, options?: NotificationOptions) => createNotification(message, options),
  confirm: showConfirm,
};

// 添加CSS样式（仅添加一次）
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

    /* Confirm Dialog */
    .ncf-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: ncfFadeIn 0.2s ease;
    }
    .ncf-overlay.ncf-closing {
      animation: ncfFadeOut 0.2s ease forwards;
    }
    .ncf-dialog {
      background: var(--surface-raised, #fff);
      border: 1px solid var(--border, #e5e5e5);
      border-radius: var(--radius-sm, 6px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      min-width: 360px;
      max-width: 480px;
      animation: ncfSlideIn 0.2s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;
    }
    .ncf-overlay.ncf-closing .ncf-dialog {
      animation: ncfSlideOut 0.2s ease forwards;
    }
    .ncf-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 20px 24px 0;
    }
    .ncf-icon {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 700;
      color: #fff;
      flex-shrink: 0;
    }
    .ncf-icon-warning { background: #f59e0b; }
    .ncf-icon-danger { background: #ef4444; }
    .ncf-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--fg, #1a1a1a);
    }
    .ncf-body {
      padding: 12px 24px 20px;
      font-size: 14px;
      color: var(--fg-muted, #666);
      line-height: 1.6;
      word-break: break-all;
    }
    .ncf-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 0 24px 20px;
    }
    .ncf-btn {
      padding: 7px 20px;
      border-radius: var(--radius-sm, 6px);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: opacity 0.15s;
      font-family: inherit;
    }
    .ncf-btn:hover { opacity: 0.85; }
    .ncf-btn:active { opacity: 0.7; }
    .ncf-btn-cancel {
      background: var(--surface, #f5f5f5);
      color: var(--fg, #1a1a1a);
      border: 1px solid var(--border, #e5e5e5);
    }
    .ncf-btn-ok {
      color: #fff;
    }

    @keyframes ncfFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes ncfFadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
    @keyframes ncfSlideIn {
      from { opacity: 0; transform: scale(0.95) translateY(-8px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes ncfSlideOut {
      from { opacity: 1; transform: scale(1) translateY(0); }
      to { opacity: 0; transform: scale(0.95) translateY(-8px); }
    }
  `;
  document.head.appendChild(style);
}

// 初始化时注入样式
injectStyles();

export default notification;
