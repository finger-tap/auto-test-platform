import { useEffect } from 'react';

/**
 * 弹窗键盘行为统一 (2026-08-27): 打开时挂 Esc 关闭。
 * 全站此前只有部分弹窗支持 Esc (confirm/FormSelect/ConnectTeamModal...),
 * TestTypeModal/DevicePickerModal/ImportToTeamModal/SelectFunctionModal/
 * HelpModal/RedeemInviteModal/TeamManageModal 只能点 ✕ 或遮罩 — 不一致
 * 且不符合商业软件的浮层惯例。
 *
 * 用法: useModalKeyboard(open, onClose)。open 为 false 时啥也不挂。
 */
export function useModalKeyboard(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);
}
