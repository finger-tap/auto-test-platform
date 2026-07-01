import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import './FormSelect.css';

interface Option {
  value: string;
  label: string;
}

interface FormSelectProps {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  size?: 'default' | 'sm' | 'compact';
  /** Use fixed positioning so the dropdown is not clipped by overflow ancestors */
  fixed?: boolean;
}

export default function FormSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  className = '',
  style,
  disabled = false,
  size = 'default',
  fixed = false,
}: FormSelectProps) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [fixedPos, setFixedPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

  // Calculate fixed position when dropdown opens
  useLayoutEffect(() => {
    if (!fixed || !open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setFixedPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });

    const updatePos = () => {
      if (!triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      setFixedPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [fixed, open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll focused option into view
  useEffect(() => {
    if (!open || focusIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[focusIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex, open]);

  const selected = options.find((o) => o.value === value);

  const handleOpen = useCallback(() => {
    if (disabled) return;
    setOpen((o) => {
      if (!o) {
        const idx = options.findIndex((o) => o.value === value);
        setFocusIndex(idx >= 0 ? idx : 0);
      }
      return !o;
    });
  }, [disabled, options, value]);

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      setOpen(false);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (open && focusIndex >= 0 && focusIndex < options.length) {
            handleSelect(options[focusIndex].value);
          } else {
            handleOpen();
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (!open) {
            handleOpen();
          } else {
            setFocusIndex((i) => Math.min(i + 1, options.length - 1));
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (open) {
            setFocusIndex((i) => Math.max(i - 1, 0));
          }
          break;
        case 'Escape':
          e.preventDefault();
          setOpen(false);
          break;
        case 'Home':
          if (open) {
            e.preventDefault();
            setFocusIndex(0);
          }
          break;
        case 'End':
          if (open) {
            e.preventDefault();
            setFocusIndex(options.length - 1);
          }
          break;
      }
    },
    [disabled, open, focusIndex, options, handleSelect, handleOpen],
  );

  const sizeClass = size !== 'default' ? ` form-select-${size}` : '';
  const dropdownStyle: React.CSSProperties = fixed
    ? {
        position: 'fixed',
        top: fixedPos.top,
        left: fixedPos.left,
        width: 'max-content',
        minWidth: 0,
        maxWidth: `calc(100vw - ${Math.max(fixedPos.left, 0)}px - 16px)`,
        zIndex: 2000,
      }
    : {};

  const dropdown = open ? (
    <div
      className="form-select-dropdown"
      ref={listRef}
      role="listbox"
      style={dropdownStyle}
    >
      {options.map((opt, i) => (
        <div
          key={opt.value}
          className={`form-select-option${opt.value === value ? ' selected' : ''}${i === focusIndex ? ' focused' : ''}`}
          role="option"
          aria-selected={opt.value === value}
          onMouseDown={(e) => { e.preventDefault(); handleSelect(opt.value); }}
          onMouseEnter={() => setFocusIndex(i)}
        >
          {opt.label}
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div
      ref={wrapRef}
      className={`form-select-wrap${sizeClass} ${className}`}
      style={style}
    >
      <div
        ref={triggerRef}
        className={`form-select-trigger${open ? ' open' : ''}${disabled ? ' disabled' : ''}`}
        onClick={handleOpen}
        onKeyDown={handleKeyDown}
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={selected ? '' : 'placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <svg className="form-select-arrow" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {fixed && dropdown ? createPortal(dropdown, document.body) : dropdown}
    </div>
  );
}
