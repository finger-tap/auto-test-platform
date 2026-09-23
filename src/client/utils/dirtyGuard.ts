import { useEffect } from 'react';
import { notification } from './notification';

/**
 * 脏状态离开保护 (2026-08-27)。
 *
 * 背景: 全部详情页都有 dirty 检测, 但它只驱动保存按钮呼吸灯 — 点侧边栏
 * /返回主页/切换测试类型会瞬间切走路由, 未保存修改无提示丢弃; 刷新或
 * 关闭标签页也不弹浏览器确认。React Router 声明式路由 (<BrowserRouter>)
 * 无法用 useBlocker(需要 data router), 因此采用"全局注册表 + 导航前确认"
 * 方案:
 *   - 详情页通过 useUnsavedGuard(isDirty) 注册脏状态并挂 beforeunload;
 *   - Layout 的侧边栏/返回主页/切换类型在 navigate 前 await confirmLeave()。
 */

let dirtyCount = 0;

export function setNavDirty(dirty: boolean): void {
  dirtyCount = Math.max(0, dirtyCount + (dirty ? 1 : -1));
}

/** 有任一页面存在未保存修改时为 true。 */
export function isNavDirty(): boolean {
  return dirtyCount > 0;
}

/**
 * 导航前调用: 无脏状态直接放行; 有则弹确认, 用户确认放弃才放行。
 */
export async function confirmLeave(): Promise<boolean> {
  if (!isNavDirty()) return true;
  return notification.confirm('当前页面有未保存的修改，离开将丢失这些修改。确定离开吗？', {
    title: '未保存的修改',
    type: 'danger',
  });
}

/**
 * 详情页接入点: dirty 变化时同步注册表, 并挂 beforeunload 拦截
 * 刷新/关闭标签页(浏览器原生确认框)。
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    setNavDirty(true);
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome 需要 returnValue 才弹确认
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      setNavDirty(false);
    };
  }, [dirty]);
}
