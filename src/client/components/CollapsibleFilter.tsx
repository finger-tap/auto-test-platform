// 2026-06-20: 可折叠筛选栏 — 主筛选常驻 + 高级筛选折叠
//
// 用法:
//   <CollapsibleFilter
//     primary={<><FilterItem label="名称"><input ... /></FilterItem>...</>}
//     advanced={<><FilterItem label="描述"><input ... /></FilterItem>...</>}
//     actions={<><button>重置</button><button>查询</button></>}
//   />

import { useState } from 'react';
import './CollapsibleFilter.css';

interface CollapsibleFilterProps {
  /** 主筛选行内容（常驻显示，建议 3-4 个筛选项） */
  primary: React.ReactNode;
  /** 高级筛选行内容（折叠显示） */
  advanced?: React.ReactNode;
  /** 操作按钮区域 */
  actions?: React.ReactNode;
}

/** 单个筛选项 — label + input 的纵向布局 */
export function FilterItem({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`alist-filter-item${className ? ` ${className}` : ''}`}>
      <label>{label}</label>
      {children}
    </div>
  );
}

export default function CollapsibleFilter({
  primary,
  advanced,
  actions,
}: CollapsibleFilterProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`alist-filter cf${expanded ? ' cf--expanded' : ''}`}>
      {/* 主筛选行 */}
      <div className="alist-filter-row cf-primary">
        {primary}
        <div className="cf-spacer" />
        {advanced && (
          <button
            type="button"
            className={`cf-toggle${expanded ? ' cf-toggle--active' : ''}`}
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            <svg
              className="cf-toggle-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="4" y1="21" x2="4" y2="14" />
              <line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" />
              <line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" />
              <line x1="9" y1="8" x2="15" y2="8" />
              <line x1="17" y1="16" x2="23" y2="16" />
            </svg>
            <span className="cf-toggle-text">{expanded ? '收起' : '高级筛选'}</span>
            <svg
              className={`cf-toggle-arrow${expanded ? ' cf-toggle-arrow--up' : ''}`}
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
            >
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {actions && (
          <div className="alist-filter-actions">
            {actions}
          </div>
        )}
      </div>

      {/* 高级筛选面板 */}
      {advanced && (
        <div className={`cf-panel${expanded ? ' cf-panel--open' : ''}`}>
          <div className="cf-panel-inner">
            <div className="alist-filter-row cf-advanced-row">
              {advanced}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
