import { useState, useRef, useEffect, type ReactNode } from 'react';
import './InlineEdit.css';

// ── FilterableSelect ── 支持输入筛选的下拉框
interface FilterableSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
  onDirty?: () => void;
  placeholder?: string;
  className?: string;
}

export function FilterableSelect({ value, options, onChange, onDirty, placeholder = '选择或输入...', className = '' }: FilterableSelectProps) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setInputVal(value); }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = inputVal
    ? options.filter(o => o.label.toLowerCase().includes(inputVal.toLowerCase()))
    : options;

  const handleSelect = (val: string) => {
    setInputVal(val);
    setOpen(false);
    onChange(val);
    onDirty?.();
  };

  return (
    <div ref={containerRef} className={`filterable-select ${className}`}>
      <input
        ref={inputRef}
        className="filterable-select-input"
        value={inputVal}
        onChange={e => { setInputVal(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
      />
      {open && (
        <div className="filterable-select-dropdown">
          {filteredOptions.length === 0 ? (
            <div className="filterable-select-empty">无匹配项</div>
          ) : (
            filteredOptions.map(o => (
              <div
                key={o.value}
                className={`filterable-select-option ${o.value === value ? 'selected' : ''}`}
                onMouseDown={e => { e.preventDefault(); handleSelect(o.value); }}
              >
                {o.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── InlineText ──

interface InlineTextProps {
  value: string;
  onChange?: (val: string) => void;   // 提交时通知父组件
  onDirty?: () => void;               // 提交时触发脏标记
  placeholder?: string;
  monospace?: boolean;
  multiline?: boolean;
  className?: string;
}

export function InlineText({ value, onChange, onDirty, placeholder, monospace, multiline, className }: InlineTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) {
      onChange?.(draft);
      onDirty?.();
    }
  };

  const cancel = () => { setEditing(false); setDraft(value); };

  if (editing) {
    const commonProps = {
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !multiline) commit();
        if (e.key === 'Escape') cancel();
      },
      placeholder: placeholder || '点击输入',
      className: 'ie-input',
    };
    if (multiline) {
      return <textarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} rows={2} {...commonProps} />;
    }
    return <input ref={inputRef as React.RefObject<HTMLInputElement>} style={monospace ? { fontFamily: 'monospace' } : undefined} {...commonProps} />;
  }

  return (
    <span className={`ie-field ${className || ''}`} onClick={() => { setDraft(value); setEditing(true); }}>
      {value ? <span className={`ie-text ${monospace ? 'ie-mono' : ''}`}>{value}</span> : <span className="ie-empty">{placeholder || '-'}</span>}
      <span className="ie-icon">✎</span>
    </span>
  );
}

// ── InlineSelect ──

interface InlineSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onChange?: (val: string) => void;
  onDirty?: () => void;
  renderDisplay?: (value: string, label: string) => ReactNode;
}

export function InlineSelect({ value, options, onChange, onDirty, renderDisplay }: InlineSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (val: string) => {
    setOpen(false);
    if (val !== value) {
      onChange?.(val);
      onDirty?.();
    }
  };

  const currentLabel = options.find(o => o.value === value)?.label || value;

  return (
    <div ref={containerRef} className="ie-select-wrap">
      <span
        className="ie-field"
        onClick={() => setOpen(o => !o)}
      >
        {renderDisplay ? renderDisplay(value, currentLabel) : <span className="ie-text">{currentLabel}</span>}
        <span className="ie-icon">✎</span>
      </span>
      {open && (
        <div className="ie-select-dropdown">
          {options.map(o => (
            <div
              key={o.value}
              className={`ie-select-option ${o.value === value ? 'selected' : ''}`}
              onMouseDown={e => { e.preventDefault(); handleSelect(o.value); }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}