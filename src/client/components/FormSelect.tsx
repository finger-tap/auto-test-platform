import React, { useState, useRef, useEffect, useCallback } from 'react';
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
}: FormSelectProps) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  return (
    <div
      ref={wrapRef}
      className={`form-select-wrap${sizeClass} ${className}`}
      style={style}
    >
      <div
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
      {open && (
        <div className="form-select-dropdown" ref={listRef} role="listbox">
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
      )}
    </div>
  );
}
