import { useMemo } from 'react';
import FormSelect from './FormSelect';

/**
 * 分页条"每页条数"选择器 (2026-08-31)。
 *
 * 选项不再固定 [10,20,50,100], 而是按视口自适应算出的满屏行数(autoSize)
 * 的 1~4 倍动态生成 — 每个选项都有明确含义: 1屏/2屏/3屏/4屏数据。
 * 当前生效值(含用户手动输入过的)始终出现在选项里。支持在下拉顶部
 * 输入 5~100 的自定义数值回车生效(后端 pageSize 上限 100)。
 *
 * 下拉方向由 FormSelect 自动测量: 分页条贴着屏幕底时向上展开。
 */

const MIN_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 100;

interface PageSizeSelectProps {
  /** 视口自适应的满屏行数(useViewportPageSize 的返回值) */
  autoSize: number;
  /** 当前生效的每页条数(userPageSize ?? autoSize) */
  value: number;
  onChange: (n: number) => void;
}

export default function PageSizeSelect({ autoSize, value, onChange }: PageSizeSelectProps) {
  const options = useMemo(() => {
    const set = new Set<number>();
    const base = Math.max(Math.min(autoSize, MAX_PAGE_SIZE), MIN_PAGE_SIZE);
    for (const k of [1, 2, 3, 4]) {
      const v = Math.min(base * k, MAX_PAGE_SIZE);
      set.add(v);
      if (v >= MAX_PAGE_SIZE) break;
    }
    // 当前值(可能是用户手动输入的)必须能回显为选中项
    set.add(Math.max(Math.min(value, MAX_PAGE_SIZE), MIN_PAGE_SIZE));
    return [...set].sort((a, b) => a - b).map(n => ({ value: String(n), label: `${n}条/页` }));
  }, [autoSize, value]);

  return (
    <FormSelect
      value={String(value)}
      options={options}
      allowCustom
      customPlaceholder={`自定义(${MIN_PAGE_SIZE}-${MAX_PAGE_SIZE})`}
      onCustomSubmit={(raw) => {
        const n = Math.round(Number(raw));
        if (!Number.isFinite(n)) return;
        onChange(Math.max(MIN_PAGE_SIZE, Math.min(n, MAX_PAGE_SIZE)));
      }}
      onChange={(val) => onChange(Number(val))}
    />
  );
}
