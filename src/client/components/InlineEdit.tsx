import { useState, useRef, useEffect, type ReactNode } from 'react';
import './InlineEdit.css';

// ── InlineText ──

interface InlineTextProps {
  value: string;
  onSave: (val: string) => void;
  placeholder?: string;
  monospace?: boolean;
  multiline?: boolean;
  className?: string;
}

export function InlineText({ value, onSave, placeholder, monospace, multiline, className }: InlineTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) {
      onSave(draft);
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

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
      return (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          rows={2}
          {...commonProps}
        />
      );
    }

    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        style={monospace ? { fontFamily: 'monospace' } : undefined}
        {...commonProps}
      />
    );
  }

  const displayText = value || placeholder || '-';

  return (
    <span
      className={`ie-field ${className || ''}`}
      onClick={() => { setDraft(value); setEditing(true); }}
    >
      {value ? (
        <span className={`ie-text ${monospace ? 'ie-mono' : ''}`}>{value}</span>
      ) : (
        <span className="ie-empty">{displayText}</span>
      )}
      <span className="ie-icon">✎</span>
    </span>
  );
}

// ── InlineSelect ──

interface InlineSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onSave: (val: string) => void;
  renderDisplay?: (value: string, label: string) => ReactNode;
}

export function InlineSelect({ value, options, onSave, renderDisplay }: InlineSelectProps) {
  const [editing, setEditing] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (editing && selectRef.current) {
      selectRef.current.focus();
    }
  }, [editing]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newVal = e.target.value;
    setEditing(false);
    if (newVal !== value) {
      onSave(newVal);
    }
  };

  const handleBlur = () => {
    setEditing(false);
  };

  const currentLabel = options.find(o => o.value === value)?.label || value;

  if (editing) {
    return (
      <select
        ref={selectRef}
        className="ie-select"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  return (
    <span className="ie-field" onClick={() => setEditing(true)}>
      {renderDisplay ? renderDisplay(value, currentLabel) : (
        <span className="ie-text">{currentLabel}</span>
      )}
      <span className="ie-icon">✎</span>
    </span>
  );
}
