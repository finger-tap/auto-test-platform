# 前端开发规范

> 基于项目实际代码总结，供开发者和 coding agent 遵循。

## 技术栈

- **框架**: React 18 + TypeScript
- **路由**: react-router-dom v7
- **构建**: Vite 5
- **样式**: 纯 CSS（CSS 变量 + BEM-like 命名）
- **状态管理**: React useState（无全局状态库）

## 目录结构

```
src/client/
├── main.tsx              # 入口
├── App.tsx               # 路由定义
├── App.css               # 全局 CSS 变量 + 基础样式
├── types/
│   └── index.ts          # 全局类型定义
├── utils/
│   ├── api.ts            # apiFetch 封装
│   ├── notification.ts   # 全局通知/确认弹窗
│   ├── datetime.ts       # 日期格式化
│   └── dialog.ts         # 对话框工具
├── components/           # 共享组件
│   ├── CollapsibleFilter.tsx
│   ├── FormSelect.tsx
│   ├── TagInput.tsx
│   ├── Layout.tsx        # 侧边栏布局
│   └── ...
├── pages/
│   ├── api-test/         # API 测试页面
│   ├── web-test/         # Web 测试页面
│   ├── pc-test/          # PC 测试页面
│   ├── mobile-test/      # 移动端测试页面
│   ├── environment/      # 环境管理
│   ├── schedule/         # 定时任务
│   └── system/           # 系统配置
└── styles/               # 共享样式
    ├── index.css          # 样式入口（@import 所有共享样式）
    ├── buttons.css
    ├── tables.css
    ├── forms.css
    └── ...
```

## API 调用规范

### 使用 apiFetch

```typescript
import { apiFetch } from '../../utils/api';

// GET 请求
const res = await apiFetch<ListResponse>('/web-cases?page=1&pageSize=10');
if (res.code === 200 && res.data) {
  setItems(res.data.items);
}

// POST 请求
const res = await apiFetch('/web-cases', {
  method: 'POST',
  body: JSON.stringify({ name, description }),
});

// DELETE 请求
const res = await apiFetch(`/web-cases/${id}`, { method: 'DELETE' });
```

**要点：**
- `apiFetch<T>` 自动携带 JWT token 和 `Content-Type: application/json`
- 返回 `{ code, message, data }` 信封格式
- 泛型参数 `T` 指定 `data` 的类型
- 错误处理：检查 `res.code === 200`，不依赖 HTTP 状态码

### 类型定义

```typescript
// 定义列表项类型
interface CaseItem {
  id: number;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

// 定义列表响应类型
interface ListResponse {
  items: CaseItem[];
  total: number;
  page: number;
  pageSize: number;
}

// 定义 API 响应类型
interface ApiResponse<T> {
  code: number;
  message: string;
  data?: T;
}
```

## 列表页规范

### 标准骨架

```tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import CollapsibleFilter, { FilterItem } from '../../components/CollapsibleFilter';
import FormSelect from '../../components/FormSelect';
import '../../pages/api-test/ApiList.css';  // 复用列表页样式

export default function XxxList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // 筛选条件
  const [fName, setFName] = useState('');
  const [fStatus, setFStatus] = useState('');

  const fetchList = (p = page, ps = pageSize) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), pageSize: String(ps) });
    if (fName) params.set('name', fName);
    if (fStatus) params.set('status', fStatus);

    apiFetch<ListResponse>(`/xxx?${params}`)
      .then(res => {
        if (res.code === 200 && res.data) {
          setItems(res.data.items || []);
          setTotal(res.data.total || 0);
        }
      })
      .catch(() => notification.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchList(); }, []);

  const handleQuery = () => { setPage(1); fetchList(1); };
  const handleReset = () => { setFName(''); setFStatus(''); setPage(1); fetchList(1); };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    const ok = await notification.confirm('确认删除？');
    if (!ok) return;
    const res = await apiFetch(`/xxx/${id}`, { method: 'DELETE' });
    if (res.code === 200) { fetchList(page); notification.success('删除成功'); }
  };

  return (
    <div className="alist page-enter">
      <CollapsibleFilter
        primary={
          <>
            <FilterItem label="名称">
              <input placeholder="搜索..." value={fName} onChange={e => setFName(e.target.value)} />
            </FilterItem>
            <FilterItem label="状态">
              <FormSelect value={fStatus} options={STATUSES} onChange={setFStatus} />
            </FilterItem>
          </>
        }
        actions={
          <>
            <button className="btn btn-default" onClick={handleReset}>重置</button>
            <button className="btn btn-primary" onClick={handleQuery}>查询</button>
            <button className="btn btn-primary" onClick={() => navigate('/xxx/new')}>新增</button>
          </>
        }
      />

      <div className="alist-table-wrap">
        {loading ? (
          <div className="alist-empty">加载中...</div>
        ) : items.length === 0 ? (
          <div className="alist-empty">暂无数据</div>
        ) : (
          <table className="alist-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort('name')}>名称 {sortIcon('name')}</th>
                <th>状态</th>
                <th>更新时间</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id} className="row-enter"
                    style={{ '--delay': `${i * 30}ms` } as React.CSSProperties}
                    onClick={() => navigate(`/xxx/${item.id}`)}>
                  <td style={{ fontWeight: 500 }}>{item.name}</td>
                  <td><span className={`status-text status-${item.status}`}>{statusLabel(item.status)}</span></td>
                  <td>{formatDateTime(item.updated_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" onClick={e => { e.stopPropagation(); navigate(`/xxx/${item.id}?exec=1`); }}>执行</button>
                      <button className="row-action-btn row-action-del" onClick={e => handleDelete(e, item.id)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="alist-pagination">
        <span className="page-info">共 {total} 条，第 {page} / {Math.ceil(total / pageSize) || 1} 页</span>
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => fetchList(page - 1)}>上一页</button>
        <button className="btn btn-sm" disabled={page >= Math.ceil(total / pageSize)} onClick={() => fetchList(page + 1)}>下一页</button>
        <FormSelect value={String(pageSize)} options={PAGE_SIZE_OPTIONS} onChange={val => fetchList(1, Number(val))} />
      </div>
    </div>
  );
}
```

### 关键点

- **根 class**: `alist page-enter`（`alist` 是列表页基础布局，`page-enter` 是入场动画）
- **筛选栏**: 用 `CollapsibleFilter` 组件，按钮放在 `actions` slot
- **按钮 class**: `btn btn-default`（重置）、`btn btn-primary`（查询/新增）
- **表格 class**: `alist-table-wrap` > `table.alist-table`
- **行动画**: `className="row-enter"` + `style={{ '--delay': `${i * 30}ms` }}`
- **分页**: `alist-pagination` 容器
- **点击行跳转**: `onClick` 在 `<tr>` 上，用 `navigate()`
- **删除**: `e.stopPropagation()` 阻止行点击，用 `notification.confirm` 确认

## 详情页规范

### 标准骨架

```tsx
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import notification from '../../utils/notification';

export default function XxxDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const [data, setData] = useState<XxxData | null>(null);
  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isNew) {
      apiFetch<{ id: number; name: string }>(`/xxx/${id}`).then(res => {
        if (res.code === 200 && res.data) {
          setData(res.data);
          setName(res.data.name);
        }
      });
    }
  }, [id]);

  const handleSave = async () => {
    if (!name.trim()) { notification.error('名称不能为空'); return; }
    setSaving(true);
    try {
      const res = isNew
        ? await apiFetch('/xxx', { method: 'POST', body: JSON.stringify({ name }) })
        : await apiFetch(`/xxx/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
      if (res.code === 200) {
        notification.success('保存成功');
        setDirty(false);
        if (isNew && res.data) navigate(`/xxx/${res.data.id}`);
      }
    } catch { notification.error('保存失败'); }
    finally { setSaving(false); }
  };

  return (
    <div className="api-detail">
      <div className="api-detail-header">
        <div className="api-detail-breadcrumb">
          <button className="api-detail-back" onClick={() => navigate('/xxx')}>← 返回</button>
          <span className="api-detail-breadcrumb-sep">/</span>
          <input className="api-detail-name-input" value={name}
                 onChange={e => { setName(e.target.value); setDirty(true); }} />
        </div>
        <button className={`btn-action${dirty ? ' dirty' : ''}`} onClick={handleSave} disabled={saving || !dirty}>
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
      <div className="api-detail-content">
        {/* 详情内容 */}
      </div>
    </div>
  );
}
```

### 关键点

- **根 class**: `api-detail`（详情页基础布局，full-bleed，无卡片边框）
- **头部**: `api-detail-header` 包含面包屑 + 保存按钮
- **面包屑**: `← 返回` / `分隔符` / `名称输入框`
- **保存按钮**: `btn-action`，有修改时加 `dirty` class（脉冲动画提示）
- **新建/编辑复用**: 通过 `id === 'new'` 判断

## 组件复用规范

### 必须复用的组件

| 组件 | 用途 | 导入路径 |
|------|------|----------|
| `CollapsibleFilter` | 列表页筛选栏 | `../../components/CollapsibleFilter` |
| `FilterItem` | 筛选项（label + input） | 同上 |
| `FormSelect` | 统一下拉选择 | `../../components/FormSelect` |
| `TagFilterSelect` | 标签筛选 | `../../components/TagFilterSelect` |
| `TagInput` | 标签输入 | `../../components/TagInput` |
| `notification` | 通知/确认弹窗 | `../../utils/notification` |
| `formatDateTime` | 日期格式化 | `../../utils/datetime` |

### notification 用法

```typescript
import notification from '../../utils/notification';

// 成功通知
notification.success('保存成功');

// 错误通知
notification.error('保存失败');

// 确认弹窗（返回 Promise<boolean>）
const ok = await notification.confirm('确认删除？');
if (!ok) return;

// 危险操作确认
const ok = await notification.confirm('此操作不可恢复，确认删除？');
```

**禁止使用：** 原生 `alert()`, `confirm()`, `window.confirm()`

## 路由规范

### 路由结构

```typescript
// src/client/App.tsx
<Route path="/api-test" element={<Layout />}>
  <Route index element={<ApiTestHome />} />
  <Route path="case" element={<ApiList />} />
  <Route path="case/:id" element={<ApiDetail />} />
  <Route path="scene" element={<ScenarioList />} />
  <Route path="scene/:id" element={<ScenarioDetail />} />
  <Route path="case-set" element={<CaseSetList />} />
  <Route path="case-set/:id" element={<CaseSetDetail />} />
  <Route path="environment" element={<EnvironmentList />} />
  <Route path="environment/:id" element={<EnvironmentDetail />} />
  <Route path="system-config" element={<SystemConfig />} />
</Route>
```

### 路径命名

- 列表页: `/{type}/{resource}` (如 `/api-test/case`)
- 详情页: `/{type}/{resource}/:id` (如 `/api-test/case/123`)
- 新建: `/{type}/{resource}/new` (如 `/api-test/case/new`)

### 4 种测试类型路由

```
/api-test/*      — API 测试
/web-test/*      — Web 测试
/pc-test/*       — PC 测试
/mobile-test/*   — 移动端测试
/settings/*      — 用户级配置（设备、模型、浏览器）
```

## 主题切换

```typescript
// 读取主题
const theme = document.documentElement.dataset.theme; // 'light' | 'dark'

// 切换主题
const toggleTheme = () => {
  const next = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
};
```

**要点：**
- 主题通过 `document.documentElement.dataset.theme` 控制
- CSS 用 `[data-theme="dark"]` 选择器覆盖变量
- 持久化到 `localStorage`

## 状态管理

- **本地状态**: `useState` 为主，不用全局状态库
- **表单状态**: 每个字段一个 `useState`
- **脏标记**: `dirty` state + `setDirty(true)` 在 onChange 中
- **加载状态**: `loading` state 控制骨架/空状态

## 导入顺序

```typescript
// 1. React
import { useState, useEffect } from 'react';

// 2. 路由
import { useNavigate, useParams } from 'react-router-dom';

// 3. 项目工具
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';

// 4. 共享组件
import CollapsibleFilter, { FilterItem } from '../../components/CollapsibleFilter';
import FormSelect from '../../components/FormSelect';

// 5. 页面样式（复用其他列表页的 CSS）
import '../api-test/ApiList.css';
```
