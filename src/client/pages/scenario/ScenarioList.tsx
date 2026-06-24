import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import type { Scenario } from '../../types';
import TagFilterSelect from '../../components/TagFilterSelect';
import FormSelect from '../../components/FormSelect';
import CollapsibleFilter, { FilterItem } from '../../components/CollapsibleFilter';
import './ScenarioList.css';

const STATUSES = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

// 根据测试类型映射到对应的 API 路径
const API_PATH_MAP: Record<string, { list: string; detail: string; create: string; delete: string }> = {
  api: { list: '/scenarios', detail: '/scenarios', create: '/scenarios', delete: '/scenarios' },
  web: { list: '/scenarios-web', detail: '/scenarios-web', create: '/scenarios-web', delete: '/scenarios-web' },
  pc: { list: '/scenarios-pc', detail: '/scenarios-pc', create: '/scenarios-pc', delete: '/scenarios-pc' },
  mobile: { list: '/scenarios-mobile', detail: '/scenarios-mobile', create: '/scenarios-mobile', delete: '/scenarios-mobile' },
};

// 根据测试类型映射路由路径
const ROUTE_PATH_MAP: Record<string, { list: string; detail: string; create: string }> = {
  api: { list: '/api-test/scene', detail: '/api-test/scene', create: '/api-test/scene/new' },
  web: { list: '/web-test/scene', detail: '/web-test/scene', create: '/web-test/scene/new' },
  pc: { list: '/pc-test/scene', detail: '/pc-test/scene', create: '/pc-test/scene/new' },
  mobile: { list: '/mobile-test/scene', detail: '/mobile-test/scene', create: '/mobile-test/scene/new' },
};

export default function ScenarioList({ basePath = '/api-test', testType = 'api' }: { basePath?: string; testType?: string } = {}) {
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);

  // Filter state
  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [filterTags, setFilterTags] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [sortField, setSortField] = useState('updated_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [forceLoad, setForceLoad] = useState(0);

  const apiPaths = API_PATH_MAP[testType] || API_PATH_MAP.api;
  const routePaths = ROUTE_PATH_MAP[testType] || ROUTE_PATH_MAP.api;

  function load() {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: sortField,
      order: sortOrder,
    });
    if (fName.trim()) params.set('name', fName.trim());

    apiFetch<{ items: Scenario[]; total: number }>(`${apiPaths.list}?${params}`).then(res => {
      if (res.code === 200 && res.data) {
        setScenarios(res.data.items);
        setTotal(res.data.total);
      }
    }).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [page, pageSize, sortField, sortOrder, forceLoad]);

  const handleCreate = () => {
    navigate(routePaths.create);
  };

  const handleDelete = async (id: number) => {
    const ok = await notification.confirm('确认删除此场景？');
    if (!ok) return;
    await apiFetch(`${apiPaths.delete}/${id}`, { method: 'DELETE' });
    setForceLoad(f => f + 1);
  };

  const handleReset = () => {
    setFName('');
    setFDesc('');
    setFilterTags('');
    setFStatus('');
    setFDateFrom('');
    setFDateTo('');
    setPage(1);
    setForceLoad(f => f + 1);
  };

  const handleQuery = () => {
    setPage(1);
    setForceLoad(f => f + 1);
  };

  const statusLabel = (s: string) => {
    if (s === 'active') return '启用';
    if (s === 'disabled') return '禁用';
    if (s === 'draft') return '草稿';
    return s;
  };

  const toggleSort = (field: string) => {
    if (sortField === field) setSortOrder(o => o === 'ASC' ? 'DESC' : 'ASC');
    else { setSortField(field); setSortOrder('DESC'); }
  };
  const sortIcon = (field: string) => {
    if (sortField !== field) return <span className="sort-icon">⇅</span>;
    return <span className="sort-icon sort-active">{sortOrder === 'ASC' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="alist page-enter">
      {/* Filter Area */}
      <CollapsibleFilter
        primary={
          <>
            <FilterItem label="场景名称">
              <input placeholder="搜索名称" value={fName} onChange={(e) => setFName(e.target.value)} />
            </FilterItem>
            <FilterItem label="标签">
              <TagFilterSelect value={filterTags} onChange={(v) => setFilterTags(v)} placeholder="按标签筛选" />
            </FilterItem>
            <FilterItem label="状态">
              <FormSelect value={fStatus} options={STATUSES} onChange={val => setFStatus(val)} />
            </FilterItem>
          </>
        }
        advanced={
          <>
            <FilterItem label="描述">
              <input placeholder="搜索描述" value={fDesc} onChange={(e) => setFDesc(e.target.value)} />
            </FilterItem>
            <FilterItem label="创建时间起">
              <input type="date" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} />
            </FilterItem>
            <FilterItem label="创建时间止">
              <input type="date" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} />
            </FilterItem>
          </>
        }
        actions={
          <>
            <button className="btn btn-default" onClick={handleReset}>重置</button>
            <button className="btn btn-primary" onClick={handleQuery}>查询</button>
            <button className="btn btn-primary" onClick={handleCreate}>新增</button>
          </>
        }
      />

      {/* Table */}
      <div className="alist-table-wrap">
        {loading ? (
          <div className="alist-empty">加载中...</div>
        ) : scenarios.length === 0 ? (
          <div className="alist-empty">暂无数据</div>
        ) : (
          <table className="alist-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort('name')}>场景名称 {sortIcon('name')}</th>
                <th>描述</th>
                <th>标签</th>
                <th>状态</th>
                <th className="sortable" onClick={() => toggleSort('created_at')}>创建时间 {sortIcon('created_at')}</th>
                <th className="sortable" onClick={() => toggleSort('updated_at')}>更新时间 {sortIcon('updated_at')}</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s, index) => (
                <tr key={s.id} className="row-enter" style={{ '--delay': `${index * 30}ms`, cursor: 'pointer' } as React.CSSProperties} onClick={() => navigate(`${basePath}/scene/${s.id}`)}>
                  <td>{s.name}</td>
                  <td className="td-desc">{s.description || '-'}</td>
                  <td>
                    {s.tags ? s.tags.split(',').filter(Boolean).map((t) => (
                      <span key={t} className="tag-badge">{t.trim()}</span>
                    )) : '-'}
                  </td>
                  <td><span className={`status-text status-${s.status}`}>{statusLabel(s.status)}</span></td>
                  <td>{formatDateTime(s.created_at)}</td>
                  <td>{formatDateTime(s.updated_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" title="执行" onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/scene/${s.id}?exec=1`); }}>执行</button>
                      <button className="row-action-btn row-action-del" title="删除" onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="alist-pagination">
        <span className="page-info">共 {total} 条，第 {page} / {Math.ceil(total / pageSize) || 1} 页</span>
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
        <button className="btn btn-sm" disabled={page >= Math.ceil(total / pageSize) || total === 0} onClick={() => setPage(p => p + 1)}>下一页</button>
        <FormSelect value={String(pageSize)} options={[{value:"10",label:"10条/页"},{value:"20",label:"20条/页"},{value:"50",label:"50条/页"},{value:"100",label:"100条/页"}]} onChange={val => { setPageSize(Number(val)); setPage(1); }} />
      </div>

    </div>
  );
}
