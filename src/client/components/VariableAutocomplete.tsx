import { useState, useRef, useEffect, useCallback } from 'react';
import type { EnvVariable } from '../types';
import { normalizeParamVars, type ParamVar } from '../utils/variableResolver';
import './VariableAutocomplete.css';

// 类型 re-export:历史调用方仍从 VariableAutocomplete 导入 ParamVar
export type { ParamVar } from '../utils/variableResolver';

// 触发键盘导航/确认/取消的键 — 这些键的 keyup 不应该重新判定 trigger,
// 否则会把刚移动过的选中重置回 0
const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta']);

interface AutocompleteItem {
  label: string;
  detail: string;
  type: 'variable' | 'function';
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  envVars: EnvVariable[];
  paramHeaders: ParamVar[] | string[];
  builtinFuncs?: { name: string; desc: string }[];
}

export default function VariableAutocomplete({
  value, onChange, onKeyDown, onBlur, placeholder, className, autoFocus,
  envVars, paramHeaders, builtinFuncs = [],
}: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AutocompleteItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [triggerStart, setTriggerStart] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 规整参数化变量,屏蔽外部传 string[] 或 ParamVar[] 的差异
  const normalizedParams = normalizeParamVars(paramHeaders);

  const buildItems = useCallback((query: string, isFunc: boolean): AutocompleteItem[] => {
    if (isFunc) {
      return builtinFuncs
        .filter(f => f.name.toLowerCase().includes(query.toLowerCase()))
        .map(f => ({ label: `${f.name}()`, detail: f.desc, type: 'function' as const }));
    }
    const vars: AutocompleteItem[] = [
      ...envVars
        .filter(v => v.enabled !== false)
        .filter(v => v.key.toLowerCase().includes(query.toLowerCase()))
        .map(v => ({ label: v.key, detail: v.description || v.value?.slice(0, 40) || '', type: 'variable' as const })),
      ...normalizedParams
        .filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
        .map(p => ({ label: p.name, detail: p.desc || '参数化变量', type: 'variable' as const })),
    ];
    return vars;
  }, [envVars, normalizedParams, builtinFuncs]);

  const detectTrigger = useCallback((text: string, cursorPos: number) => {
    // Check for {{ trigger (variable)
    const before = text.slice(0, cursorPos);
    const varMatch = before.match(/\{\{([\w]*)$/);
    if (varMatch) {
      const start = cursorPos - varMatch[0].length;
      const query = varMatch[1];
      const matched = buildItems(query, false);
      if (matched.length > 0) {
        setItems(matched);
        setTriggerStart(start);
        setSelectedIdx(0);
        setOpen(true);
        return;
      }
    }

    // Check for ${ trigger (function)
    const funcMatch = before.match(/\$\{([\w]*)$/);
    if (funcMatch) {
      const start = cursorPos - funcMatch[0].length;
      const query = funcMatch[1];
      const matched = buildItems(query, true);
      if (matched.length > 0) {
        setItems(matched);
        setTriggerStart(start);
        setSelectedIdx(0);
        setOpen(true);
        return;
      }
    }

    setOpen(false);
  }, [buildItems]);

  const insertItem = useCallback((item: AutocompleteItem) => {
    if (triggerStart < 0) return;
    const input = inputRef.current;
    if (!input) return;
    const cursorPos = input.selectionStart || 0;
    const before = value.slice(0, triggerStart);
    let after = value.slice(cursorPos);

    // If cursor is inside {{|}} or ${|}, skip the existing closing braces
    if (item.type === 'function' && after.startsWith('}')) {
      after = after.slice(1);
    } else if (item.type === 'variable' && after.startsWith('}}')) {
      after = after.slice(2);
    }

    const insertion = item.type === 'function' ? `\${${item.label.replace('()', '(')}}` : `{{${item.label}}}`;
    const newValue = before + insertion + after;
    onChange(newValue);
    setOpen(false);
    setTriggerStart(-1);

    // Restore cursor position after insertion
    requestAnimationFrame(() => {
      const newPos = triggerStart + insertion.length;
      input.setSelectionRange(newPos, newPos);
      input.focus();
    });
  }, [value, triggerStart, onChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    onChange(newVal);
    const cursorPos = e.target.selectionStart || newVal.length;
    detectTrigger(newVal, cursorPos);
  };

  // Re-detect trigger when cursor moves (click, arrow keys, etc.)
  const recheckCursor = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const cursorPos = input.selectionStart ?? 0;
    detectTrigger(value, cursorPos);
  }, [value, detectTrigger]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => Math.min(i + 1, items.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (items[selectedIdx]) {
          e.preventDefault();
          insertItem(items[selectedIdx]);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }
    onKeyDown?.(e);
  };

  // onKeyUp 不能直接挂 recheckCursor:ArrowDown/Up 释放时也会触发,
  // recheckCursor → detectTrigger → setSelectedIdx(0),把刚刚 ArrowDown
  // 移动到 index 1 的选中重置回 0,看起来就是"只能移动到第二项就回到第一项"。
  // 跳过导航键,只在真正会改变输入内容的键释放时重新判定 trigger。
  const handleInputKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (NAV_KEYS.has(e.key)) return;
    recheckCursor();
  };

  const handleInputBlur = () => {
    // Delay close to allow click on dropdown
    setTimeout(() => {
      setOpen(false);
      onBlur?.();
    }, 150);
  };

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && open) {
      const selected = listRef.current.children[selectedIdx] as HTMLElement;
      if (selected) selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIdx, open]);

  return (
    <div className="var-autocomplete-wrap">
      <input
        ref={inputRef}
        className={className}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        onKeyUp={handleInputKeyUp}
        onClick={recheckCursor}
        onBlur={handleInputBlur}
        onFocus={() => { if (value) detectTrigger(value, inputRef.current?.selectionStart || value.length); }}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      {open && items.length > 0 && (
        <div className="var-autocomplete-list" ref={listRef}>
          {items.map((item, idx) => (
            <div
              key={`${item.type}-${item.label}`}
              className={`var-autocomplete-item ${idx === selectedIdx ? 'selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); insertItem(item); }}
              onMouseEnter={() => setSelectedIdx(idx)}
            >
              <span className={`var-ac-icon ${item.type}`}>{item.type === 'function' ? 'ƒ' : '{x}'}</span>
              <span className="var-ac-label">{item.label}</span>
              {item.detail && <span className="var-ac-detail">{item.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
