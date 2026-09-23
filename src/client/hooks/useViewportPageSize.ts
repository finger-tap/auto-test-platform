import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 列表页每页行数自适应 (2026-08-31)。
 *
 * 直接测量表格滚动容器的真实可用高度:
 *   capacity = floor((wrapHeight - theadHeight) / 自然行高)
 * thead/行高从实际渲染的 DOM 读取(表格未渲染时用回退常量)。
 *
 * 恰好填满: floor 的余数(最多接近一整行)不留白 — 满页时把每行微拉伸到
 * 可用高度/行数(设 --row-h, 每行 +1~2px, 上限 +8px), 表格底部与分页条
 * 严丝合缝; 行数不足一页或手动选大页时保持自然行高。
 *
 * 结构(2026-08-31 修正): 容器元素存 state, ResizeObserver/MutationObserver
 * 完全由 effect 拥有并在其 cleanup 中释放 — 此前观察器在 callback ref 里
 * 创建、在 effect cleanup 里断开, StrictMode 的"挂载→清理→重挂"会把
 * 观察器杀掉且无人重建(callback ref 不会重跑), 表现为行数校准/窗口
 * 缩放全部失效。
 *
 * 用法:
 *   const [autoPageSize, tableWrapRef] = useViewportPageSize();
 *   <div className="alist-table-wrap" ref={tableWrapRef}>
 * 页面侧用 userPageSize ?? autoPageSize — 用户手动选择后以手动值为准。
 * 返回值钳制在 [5, 100] (后端 pageSize 上限 100)。
 */

const MIN_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 100;
// 表格未渲染时(loading/空态)的回退常量; 数据渲染后会被实测值替换
const FALLBACK_THEAD_H = 38;
const FALLBACK_ROW_H = 45;
// 行高校准的自适应调整次数上限, 防止"换行数据↔行数"来回震荡
const MAX_MUTATION_ADJUSTS = 6;
// 恰好填满时单行允许的最大拉伸量(px): 消除取整余数, 但行距不失真
const MAX_ROW_STRETCH = 8;

export function useViewportPageSize(
  fallbackRowHeight = FALLBACK_ROW_H,
): [number, (el: HTMLElement | null) => void] {
  // 首帧粗估值, 仅影响第一次请求; 容器挂载后即被精确值替换
  const estimate = useCallback(() => {
    if (typeof window === 'undefined') return 10;
    return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor((window.innerHeight - 240) / fallbackRowHeight)));
  }, [fallbackRowHeight]);

  const [size, setSize] = useState(estimate);
  const sizeRef = useRef(estimate());
  // 容器元素放 state(而非 ref): 元素挂载/卸载能触发 effect 重建观察器
  const [wrapEl, setWrapEl] = useState<HTMLElement | null>(null);
  const adjustsRef = useRef(0);
  // 自然行高(未拉伸时实测一次并缓存): 行数容量必须按它算, 若按拉伸后的
  // 行高算会形成"拉伸→行高变大→行数变少→再拉伸"的反馈回路
  const naturalRowHRef = useRef<number | null>(null);

  const applySize = useCallback((next: number) => {
    if (sizeRef.current === next) return false;
    sizeRef.current = next;
    setSize(next);
    return true;
  }, []);

  const compute = useCallback(() => {
    const el = wrapEl;
    // 容器暂未渲染(MockList loading 分支)时沿用上次结果, 不回退粗估值
    if (!el) return sizeRef.current;
    // clientHeight 由 flex 布局决定(与内容多少无关), 且已扣除横向滚动条高度
    const wrapH = el.clientHeight;
    if (wrapH <= 0) return sizeRef.current;
    const thead = el.querySelector('thead');
    const theadH = thead ? thead.getBoundingClientRect().height : FALLBACK_THEAD_H;
    const tbody = el.querySelector('tbody');
    const rowCount = tbody ? tbody.children.length : 0;

    // 行高只在"未拉伸"状态下测量并缓存; 拉伸只改行盒高度, 不改 DOM 结构,
    // 不会触发 MutationObserver(childList), 也不会改变容器高度触发 ResizeObserver
    const stretching = el.style.getPropertyValue('--row-h') !== '';
    if (tbody && rowCount >= 2 && !stretching && naturalRowHRef.current === null) {
      naturalRowHRef.current = tbody.getBoundingClientRect().height / rowCount;
    }
    const natural = naturalRowHRef.current ?? fallbackRowHeight;
    const avail = wrapH - theadH;
    const capacity = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(avail / Math.max(natural, 1))));

    // -1px 安全余量: 设备像素取整可能让行高和恰好多出零点几像素, 顶出滚动条
    const exact = (avail - 1) / capacity;
    if (rowCount === capacity && exact >= natural && exact <= natural + MAX_ROW_STRETCH) {
      el.style.setProperty('--row-h', `${exact}px`);
    } else {
      el.style.removeProperty('--row-h');
    }
    return capacity;
  }, [wrapEl, fallbackRowHeight]);

  // 同步计算, 不走 requestAnimationFrame — 后台/被遮挡的标签页 rAF 会被
  // 浏览器暂停, 窗口缩放后的行数重算将永远不执行(实测踩坑)。compute 只读
  // 几个 rect, 高频 resize 下的开销可接受。
  const measure = useCallback(() => {
    applySize(compute());
  }, [compute]);

  // 观察器与容器元素同生命周期: 元素挂载时创建, 卸载/重挂(StrictMode)时
  // 由 cleanup 释放并重建 — 不再出现"清理杀掉观察器却无人重建"的空窗
  useEffect(() => {
    if (!wrapEl) return;
    adjustsRef.current = 0;
    // 挂载即同步测一次: 在浏览器绘制前给出精确值, 首次请求就用对行数
    applySize(compute());

    const ro = new ResizeObserver(() => {
      // 容器尺寸变化 = 布局真实变化(窗口缩放/筛选展开), 重置校准额度
      adjustsRef.current = 0;
      measure();
    });
    ro.observe(wrapEl);

    const mo = new MutationObserver(() => {
      if (adjustsRef.current >= MAX_MUTATION_ADJUSTS) return;
      if (applySize(compute())) adjustsRef.current++;
    });
    mo.observe(wrapEl, { childList: true, subtree: true });

    const onResize = () => {
      adjustsRef.current = 0;
      measure();
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      mo.disconnect();
    };
  }, [wrapEl, compute, measure, applySize]);

  return [size, setWrapEl];
}
