import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import './TagInput.css';

interface TagInfo {
  name: string;
  color: string;
  count: number;
  sources: { apis: number; scenarios: number; scenario_sets: number };
}

/** 根据主色生成浅色背景 + 深色文字的内联样式 */
function tagStyle(color: string): React.CSSProperties | undefined {
  if (!color) return undefined;
  return {
    background: `${color}18`,
    color: color,
    borderColor: `${color}40`,
  };
}

interface TagInputProps {
  value: string;
  onChange: (tags: string) => void;
  onDirty?: () => void;
  placeholder?: string;
}

/**
 * 标签选择器：点击弹出下拉框选择标签
 * 标签在「系统配置 - 标签管理」页面统一创建和删除
 */
export default function TagInput({ value, onChange, onDirty, placeholder = '点击选择标签' }: TagInputProps) {
  const [open, setOpen] = useState(false);
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [initialSelected, setInitialSelected] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLSpanElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isClickInsideRef = useRef(false);

  const tags = value ? value.split(',').map((t) => t.trim()).filter(Boolean) : [];

  // 加载所有标签
  useEffect(() => {
    apiFetch<TagInfo[]>('/tags').then((res) => {
      if (res.code === 200 && res.data) setAllTags(res.data);
    }).catch(() => { /* ignore */ });
  }, []);

  // 打开时记录初始选中状态
  useEffect(() => {
    if (open) {
      setSelected(new Set(tags));
      setInitialSelected(new Set(tags));
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  // 不再监听外部点击关闭，改为点击空白区域关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const toggleTag = useCallback((name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const confirm = () => {
    const tagString = Array.from(selected).join(', ');
    console.log('[TagInput] confirm, selected:', Array.from(selected), '-> onChange:', tagString);
    onChange(tagString);
    onDirty?.();
    setOpen(false);
  };

  const cancel = () => {
    setSelected(initialSelected);
    setOpen(false);
  };

  // 点击空白区域关闭
  const handleOverlayClick = () => {
    console.log('[TagInput] overlay click, reset to:', Array.from(initialSelected));
    setSelected(initialSelected);
    setOpen(false);
  };

  // 计算弹窗位置（下方）
  const getPosition = () => {
    if (!containerRef.current) return { top: 0, left: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      top: rect.bottom + 8,
      left: rect.left,
    };
  };

  const filteredTags = search.trim()
    ? allTags.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    : allTags;

  const pos = getPosition();

  return (
    <>
      <span
        ref={containerRef}
        className={`ie-field ${open ? 'ie-field-editing' : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        {tags.length > 0 ? (
          <span className="ie-text tag-display-text">
            {tags.map((t, i) => {
              const tagData = allTags.find(at => at.name === t);
              return (
                <span key={i} className="tag-pill-display" style={tagStyle(tagData?.color || '')}>{t}</span>
              );
            })}
          </span>
        ) : (
          <span className="ie-empty">{placeholder}</span>
        )}
        <span className="ie-icon">{open ? '▲' : '✎'}</span>
      </span>

      {open && (
        <>
          {/* 遮罩层，点击关闭 */}
          <div className="tag-dropdown-overlay" onClick={handleOverlayClick} />
          {/* 下拉弹窗 */}
          <div
            ref={dropdownRef}
            className="tag-dropdown"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="tag-dropdown-header">
              <span className="tag-dropdown-title">选择标签</span>
              <input
                ref={searchRef}
                className="tag-dropdown-search"
                placeholder="搜索标签"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="tag-dropdown-list">
              {filteredTags.length === 0 ? (
                <div className="tag-dropdown-empty">
                  {search ? '未找到匹配的标签' : '暂无可选标签，请先在「系统配置 - 标签管理」中添加'}
                </div>
              ) : (
                filteredTags.map(tag => (
                  <span
                    key={tag.name}
                    className={`tag-dropdown-item ${selected.has(tag.name) ? 'checked' : ''}`}
                    style={tagStyle(tag.color)}
                    onClick={() => toggleTag(tag.name)}
                  >
                    {tag.name}
                    {selected.has(tag.name) && <span className="tag-dropdown-check">✓</span>}
                  </span>
                ))
              )}
            </div>

            <div className="tag-dropdown-footer">
              <span className="tag-dropdown-hint">已选 {selected.size} 个</span>
              <div className="tag-dropdown-btns">
                <button className="tag-dropdown-btn-cancel" onClick={cancel}>取消</button>
                <button className="tag-dropdown-btn-confirm" onClick={confirm}>确定</button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}