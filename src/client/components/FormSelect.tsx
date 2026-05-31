import React, { useState, useRef, useEffect } from 'react';
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
}

export default function FormSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  className = '',
  style,
}: FormSelectProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  const selected = options.find((o: Option) => o.value === value);

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
  };

  return (
    <div
      ref={wrapRef}
      className={`form-select-wrap ${className}`}
      style={style}
    >
      <div
        className={`form-select-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen((o: boolean) => !o)}
      >
        <span className={selected ? '' : 'placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <svg className="form-select-arrow" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {open && (
        <div className="form-select-dropdown">
          {options.map((opt: Option) => (
            <div
              key={opt.value}
              className={`form-select-option ${opt.value === value ? 'selected' : ''}`}
              onMouseDown={(e: React.MouseEvent) => { e.preventDefault(); handleSelect(opt.value); }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}