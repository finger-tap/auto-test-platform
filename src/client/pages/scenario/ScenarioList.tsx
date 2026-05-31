import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import type { Scenario } from '../../types';
import TagFilterSelect from '../../components/TagFilterSelect';
import FormSelect from '../../components/FormSelect';
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
  api: { list: '/api-test/scene-case', detail: '/api-test/scene-case', create: '/api-test/scene-case/new' },
  web: { list: '/web-test/scene', detail: '/web-test/scene', create: '/web-test/scene/new' },
  pc: { list: '/pc-test/scene', detail: '/pc-test/scene', create: '/pc-test/scene/new' },
  mobile: { list: '/mobile-test/scene-case', detail: '/mobile-test/scene-case', create: '/mobile-test/scene-case/new' },
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

  const apiPaths = API_PATH_MAP[testType] || API_PATH_MAP.api;
  const routePaths = ROUTE_PATH_MAP[testType] || ROUTE_PATH_MAP.api;

  const fetchScenarios = async (pageNum = 1, pageSz = pageSize) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: String(pageNum), pageSize: String(pageSz), sort: sortField, order: sortOrder });
      if (fName.trim()) params.set('name', fName.trim());
      const res = await apiFetch<{ items: Scenario[]; total: number; page: number; pageSize: number }>(`${apiPaths.list}?${params}`);
      if (res.code === 200 && res.data) {
        setScenarios(res.data.items);
        setTotal(res.data.total);
        setPage(res.data.page);
        setPageSize(res.data.pageSize);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchScenarios(); }, [sortField, sortOrder, testType, fName]);

  const handleCreate = () => {
    navigate(routePaths.create);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此场景？')) return;
    await apiFetch(`${apiPaths.delete}/${id}`, { method: 'DELETE' });
    fetchScenarios(page);
  };

  const handleReset = () => {
    setFName('');
    setFDesc('');
    setFilterTags('');
    setFStatus('');
    setFDateFrom('');
    setFDateTo('');
  };

  const filtered = scenarios.filter((s) => {
    if (fStatus && s.status !== fStatus) return false;
    if (fName) {
      const search = fName.toLowerCase();
      if (!s.name.toLowerCase().includes(search)) return false;
    }
    if (fDesc && !(s.description || '').toLowerCase().includes(fDesc.toLowerCase())) return false;
    if (filterTags) {
      const tags = (s.tags || '').split(',').map(t => t.trim()).filter(Boolean);
      if (!tags.includes(filterTags)) return false;
    }
    if (fDateFrom && s.created_at < fDateFrom) return false;
    if (fDateTo && s.created_at > fDateTo + 'T23:59:59') return false;
    return true;
  });

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
    <div className="alist">
      {/* Filter Area */}
      <div className="alist-filter">
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>场景名称</label>
            <input placeholder="搜索名称" value={fName} onChange={(e) => setFName(e.target.value)} onBlur={() => fetchScenarios(1)} />
          </div>
          <div className="alist-filter-item">
            <label>描述</label>
            <input placeholder="搜索描述" value={fDesc} onChange={(e) => setFDesc(e.target.value)} onBlur={() => fetchScenarios(1)} />
          </div>
          <div className="alist-filter-item">
            <label>标签</label>
            <TagFilterSelect value={filterTags} onChange={(v) => { setFilterTags(v); fetchScenarios(1); }} placeholder="按标签筛选" />
          </div>
          <div className="alist-filter-item">
            <label>状态</label>
            <FormSelect
              value={fStatus}
              options={STATUSES}
              onChange={val => { setFStatus(val); fetchScenarios(1); }}
            />
          </div>
        </div>
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>创建时间起</label>
            <input type="date" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} onBlur={() => fetchScenarios(1)} />
          </div>
          <div className="alist-filter-item">
            <label>创建时间止</label>
            <input type="date" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} onBlur={() => fetchScenarios(1)} />
          </div>
          <div className="alist-filter-actions">
            <button className="btn btn-default" onClick={() => { handleReset(); fetchScenarios(1); }}>重置</button>
            <button className="btn btn-primary" onClick={handleCreate}>新增</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="alist-table-wrap">
        {loading ? (
          <div className="alist-empty">加载中...</div>
        ) : filtered.length === 0 ? (
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
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} onClick={() => navigate(`${basePath}/scene-case/${s.id}`)} style={{ cursor: 'pointer' }}>
                  <td>{s.name}</td>
                  <td className="td-desc">{s.description || '-'}</td>
                  <td>
                    {s.tags ? s.tags.split(',').filter(Boolean).map((t) => (
                      <span key={t} className="tag-badge">{t.trim()}</span>
                    )) : '-'}
                  </td>
                  <td><span className={`status-text status-${s.status}`}>{statusLabel(s.status)}</span></td>
                  <td>{s.created_at.replace('T', ' ').slice(0, 16)}</td>
                  <td>{s.updated_at.replace('T', ' ').slice(0, 16)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" title="执行" onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/scene-case/${s.id}?exec=1`); }}>▶</button>
                      <button className="row-action-btn row-action-del" title="删除" onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}>✕</button>
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
        <span className="page-info">共 {total} 条，第 {page} / {Math.ceil(total / pageSize)} 页</span>
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => fetchScenarios(page - 1)}>上一页</button>
        <button className="btn btn-sm" disabled={page >= Math.ceil(total / pageSize)} onClick={() => fetchScenarios(page + 1)}>下一页</button>
        <FormSelect value={String(pageSize)} options={[{value:"10",label:"10条/页"},{value:"20",label:"20条/页"},{value:"50",label:"50条/页"},{value:"100",label:"100条/页"}]} onChange={val => fetchScenarios(1, Number(val))} />
      </div>

    </div>
  );
}
