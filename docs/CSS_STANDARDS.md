# CSS 样式规范

> 基于项目实际代码总结，供开发者和 coding agent 遵循。

## 设计 Token（CSS 变量）

所有颜色、间距、圆角、阴影必须使用 CSS 变量，禁止硬编码色值。

### 颜色系统

```css
:root {
  /* 背景 */
  --bg: #f7f7fa;              /* 页面背景 */
  --surface: #ffffff;          /* 卡片/面板背景 */
  --surface-raised: #fcfcff;   /* 悬停/浮起背景 */

  /* 前景文字 */
  --fg: #27272a;               /* 主文字 */
  --fg-secondary: #71717a;     /* 次要文字 */
  --fg-tertiary: #a1a1aa;      /* 辅助/占位文字 */

  /* 边框 */
  --border: #e8e8ec;           /* 主边框 */
  --border-subtle: #f1f1f3;    /* 细线/分割线 */

  /* 主题色 */
  --accent: #6366f1;           /* 主色调（靛蓝） */
  --accent-subtle: #eef2ff;    /* 主色调淡底 */
  --accent-hover: #818cf8;     /* 主色调悬停 */

  /* 语义色 */
  --success: #22c55e;          /* 成功/通过 */
  --success-subtle: #f0fdf4;
  --warning: #f59e0b;          /* 警告 */
  --warning-subtle: #fffbeb;
  --danger: #ef4444;           /* 危险/失败 */
  --danger-subtle: #fef2f2;
  --info: #6366f1;             /* 信息 */
  --info-subtle: #eef2ff;
}
```

### 暗色主题

```css
[data-theme="dark"] {
  color-scheme: dark;
  --bg: #09090b;
  --surface: #18181b;
  --surface-raised: #1e1e22;
  --fg: #fafafa;
  --fg-secondary: #a1a1aa;
  --fg-tertiary: #71717a;
  --border: #3f3f46;
  --border-subtle: #2a2a30;
  --accent: #818cf8;
  --accent-subtle: rgba(99,102,241,0.12);
  --accent-hover: #a5b4fc;
  --success: #4ade80;
  --success-subtle: rgba(34,197,94,0.12);
  --warning: #fbbf24;
  --warning-subtle: rgba(245,158,11,0.12);
  --danger: #f87171;
  --danger-subtle: rgba(239,68,68,0.12);
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 2px 8px rgba(0,0,0,0.4);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.5);
}
```

**要点：**
- 暗色主题用 `[data-theme="dark"]` 选择器
- 语义色在暗色下用 `rgba` 半透明底色（不是简单加深）
- 阴影在暗色下需要更重的透明度

### 布局变量

```css
:root {
  --sidebar-w: 240px;          /* 侧边栏宽度 */
  --header-h: 52px;            /* 头部高度 */

  --radius-sm: 6px;            /* 小圆角（按钮、输入框） */
  --radius-md: 8px;            /* 中圆角（卡片、表格） */
  --radius-lg: 12px;           /* 大圆角（弹窗） */

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 2px 8px rgba(0,0,0,0.06);
  --shadow-lg: 0 8px 24px #00000014;

  --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;
  --font-mono: 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;
}
```

## 样式文件组织

```
src/client/
├── App.css                    # 全局变量 + 基础 reset
├── styles/
│   ├── index.css              # @import 所有共享样式
│   ├── buttons.css            # .btn 系统
│   ├── tables.css             # .alist-table 系统
│   ├── forms.css              # .form-* 系统
│   ├── filters.css            # .alist-filter 系统
│   ├── badges.css             # .badge / .tag-pill / .status-dot
│   ├── pagination.css         # .alist-pagination
│   ├── empty.css              # .alist-empty
│   ├── animations.css         # .page-enter / .row-enter / .hover-lift
│   ├── timeline.css           # 时间线组件
│   ├── tabs.css               # Tab 切换
│   ├── modals.css             # 弹窗
│   └── detail-components.css  # 详情页共享布局
└── pages/
    ├── api-test/
    │   ├── ApiList.css        # 列表页特定样式
    │   └── ApiDetail.css      # 详情页特定样式
    └── web-test/
        └── WebCaseDetail.css  # Web 详情页特定样式
```

**导入方式：**
- 共享样式通过 `src/client/main.tsx` 全局导入
- 页面特定样式在页面文件中单独导入
- 列表页复用：`import '../api-test/ApiList.css'`（所有列表页共用同一套 CSS）

## 命名约定

### 前缀规则

| 前缀 | 用途 | 示例 |
|------|------|------|
| `alist-` | 列表页通用 | `alist-table`, `alist-filter`, `alist-pagination` |
| `adetail-` / `api-detail` | 详情页通用 | `api-detail-header`, `api-detail-content` |
| `sys-` | 系统/设置页 | `sys-root`, `sys-card`, `sys-sidebar` |
| `btn` | 按钮系统 | `btn`, `btn-primary`, `btn-danger` |
| `form-` | 表单系统 | `form-group`, `form-input`, `form-label` |
| `cf-` | 可折叠筛选 | `cf-toggle`, `cf-panel` |
| `status-` | 状态标记 | `status-text`, `status-active`, `status-draft` |
| `tag-` | 标签 | `tag-badge`, `tag-pill` |

### 命名风格

- 使用 kebab-case: `alist-table-wrap`, `btn-primary`
- 状态修饰符用 `--`: `cf--expanded`, `btn--loading`
- 语义化命名: `.alist-empty` 而不是 `.text-center-gray`

## 按钮系统

```css
/* 基础按钮 */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
```

### 变体

| Class | 用途 | 外观 |
|-------|------|------|
| `btn btn-primary` | 主操作（查询、新增、保存） | 紫色填充 |
| `btn btn-default` | 次要操作（重置、取消） | 白色描边 |
| `btn btn-danger` | 危险操作（删除） | 红色填充 |
| `btn btn-success` | 成功操作 | 绿色填充 |
| `btn btn-outline` | 强调次要操作 | 紫色描边 |
| `btn btn-ghost` | 低调操作 | 透明描边 |
| `btn btn-text` | 文字链接式 | 无边框紫色文字 |

### 尺寸

| Class | 高度 | 用途 |
|-------|------|------|
| `btn-sm` | 26px | 表格内、分页 |
| 默认 | 32px | 筛选栏、表单 |
| `btn-lg` | 40px | 页面级主按钮 |

### 行内操作按钮

```css
.row-action-btn {
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  background: none;
  color: var(--fg-secondary);
}
.row-action-btn:hover {
  background: var(--accent-subtle);
  color: var(--accent);
}
.row-action-del:hover {
  background: var(--danger-subtle);
  color: var(--danger);
}
```

## 表格系统

```css
.alist-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}
.alist-table {
  width: 100%;
  border-collapse: collapse;
}
.alist-table th {
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  font-size: 12px;
  color: var(--fg-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  position: sticky;
  top: 0;
}
.alist-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 13px;
}
.alist-table tbody tr:hover td {
  background: var(--surface-raised);
}
```

**要点：**
- 表头 sticky 固定在顶部
- 最后一列（操作列）sticky 固定在右侧
- 悬停行变色: `var(--surface-raised)`

## 表单系统

```css
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--fg-secondary);
}
.form-input, .form-select {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--surface);
  color: var(--fg);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.form-input:focus, .form-select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}
```

## 筛选栏系统

```css
.alist-filter {
  padding: 16px;
  border-bottom: 1px solid var(--border-subtle);
}
.alist-filter-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}
.alist-filter-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.alist-filter-item label {
  font-size: 12px;
  color: var(--fg-secondary);
  font-weight: 500;
}
.alist-filter-item input,
.alist-filter-item select {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.alist-filter-actions {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  margin-left: auto;  /* 按钮靠右 */
}
```

## 状态与徽章

```css
/* 状态文字 */
.status-text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;
}
.status-active { background: var(--success-subtle); color: var(--success); }
.status-draft { background: var(--border-subtle); color: var(--fg-secondary); }
.status-disabled { background: var(--danger-subtle); color: var(--danger); }

/* 标签徽章 */
.tag-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  background: var(--accent-subtle);
  color: var(--accent);
  margin-right: 4px;
}

/* 通用徽章 */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;
}
.badge-success { background: var(--success-subtle); color: var(--success); }
.badge-warning { background: var(--warning-subtle); color: var(--warning); }
.badge-danger { background: var(--danger-subtle); color: var(--danger); }
```

## 动画规范

### 页面入场

```css
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
.page-enter {
  animation: fadeInUp 0.3s ease-out;
}
```

### 行入场（交错）

```css
@keyframes rowFadeIn {
  from { opacity: 0; transform: translateX(-8px); }
  to { opacity: 1; transform: translateX(0); }
}
.row-enter {
  animation: rowFadeIn 0.2s ease-out both;
  animation-delay: var(--delay, 0ms);
}
```

使用方式：
```tsx
<tr className="row-enter" style={{ '--delay': `${index * 30}ms` } as React.CSSProperties}>
```

### 保存按钮脉冲

```css
.btn-action.dirty {
  border-color: var(--accent);
  color: var(--accent);
  animation: btn-dirty-pulse 1.5s ease-in-out infinite;
}
@keyframes btn-dirty-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.3); }
  50% { box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.15); }
}
```

### 骨架屏加载

```css
@keyframes shimmer {
  from { background-position: -200% 0; }
  to { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, var(--border-subtle) 25%, var(--surface-raised) 50%, var(--border-subtle) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}
```

### 动画性能规则

**可以动画的属性（高性能）：**
- `transform`
- `opacity`
- `box-shadow`（轻微）

**禁止动画的属性（触发布局重排）：**
- `width`, `height`
- `margin`, `padding`
- `top`, `left`, `right`, `bottom`
- `font-size`

## 响应式断点

```css
@media (max-width: 900px) {
  .kanban-grid { grid-template-columns: repeat(2, 1fr); }
  .home-bottom-grid { grid-template-columns: 1fr; }
}
@media (max-width: 540px) {
  .kanban-grid { grid-template-columns: 1fr; }
}
```

项目主要面向桌面端，响应式需求较低。移动端适配按需添加。

## 禁止事项

- **禁止硬编码颜色**: 必须用 `var(--xxx)`，不能写 `#6366f1` 或 `rgb(99,102,241)`
- **禁止内联样式做主题相关设置**: 颜色、背景、边框必须走 CSS 变量
- **禁止 !important**: 如果优先级不够，提升选择器特异性
- **禁止全局 reset 覆盖**: 不要修改 `* { box-sizing }` 等已有的全局规则
- **禁止重复定义**: 如果样式在 `styles/` 下已有，直接用，不要在页面 CSS 里重写
