import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api';
import './TagFilterSelect.css';
import './TagFilterSelect.css';
interface TagInfo {
  name: string;
  count: number;
  sources: { apis: number; scenarios: number; scenario_sets: number };
}

interface TagFilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function TagFilterSelect({
  value,
  onChange,
  placeholder = '按标签筛选',
}: TagFilterSelectProps) {
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<TagInfo[]>('/tags').then(res => {
      if (res.code === 200 && res.data) setTags(res.data);
    });
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = tags.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  const visibleTags = filtered;

  return (
    <div className="tfs-root" ref={ref}>
      <div className="tfs-trigger" onClick={() => setOpen(!open)}>
        {value ? (
          <span className="tfs-tag-active">{value} <span className="tfs-clear" onClick={(e) => { e.stopPropagation(); onChange(''); }}>×</span></span>
        ) : (
          <span className="tfs-placeholder">{placeholder}</span>
        )}
        <span className="tfs-arrow">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="tfs-dropdown">
          <div className="tfs-search-wrap">
            <input
              className="tfs-search"
              placeholder="搜索标签..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="tfs-options">
            <div
              className={`tfs-option ${!value ? 'tfs-option-selected' : ''}`}
              onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
            >
              <span>全部</span>
            </div>
            {visibleTags.length === 0 ? (
              <div className="tfs-empty">无标签</div>
            ) : (
              visibleTags.map(t => (
                <div
                  key={t.name}
                  className={`tfs-option ${value === t.name ? 'tfs-option-selected' : ''}`}
                  onClick={() => { onChange(t.name); setOpen(false); setSearch(''); }}
                >
                  <span className="tfs-opt-name">{t.name}</span>
                  <span className="tfs-opt-count">{t.count}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
