import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import TagFilterSelect from '../../components/TagFilterSelect';
import FormSelect from '../../components/FormSelect';
import './CaseSetList.css';

interface SetItem {
  id: number;
  name: string;
  description: string | null;
  tags: string;
  status: string;
  case_count: number;
  created_at: string;
  updated_at: string;
  execution_summary?: {
    total: number;
    passed: number;
    failed: number;
    last_executed_at: string;
  } | null;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  active: { label: '启用', color: '#52c41a' },
  disabled: { label: '禁用', color: '#999' },
  draft: { label: '草稿', color: '#faad14' },
};

// 用例集 API 路径按测试类型映射
// - api: 仍走 /scenario-sets（沿用"场景集"概念）
// - web/pc/mobile: 走 /case-sets-{web,pc,mobile}
const API_PATH_MAP: Record<string, { list: string; delete: string }> = {
  api: { list: '/scenario-sets', delete: '/scenario-sets' },
  web: { list: '/case-sets-web', delete: '/case-sets-web' },
  pc: { list: '/case-sets-pc', delete: '/case-sets-pc' },
  mobile: { list: '/case-sets-mobile', delete: '/case-sets-mobile' },
};

// 路由路径按测试类型映射
// - api: /api-test/scene-set（保留场景集术语）
// - web/pc/mobile: /{testType}/case-set
const ROUTE_PATH_MAP: Record<string, { list: string; detail: string; create: string }> = {
  api: { list: '/api-test/scene-set', detail: '/api-test/scene-set', create: '/api-test/scene-set/new' },
  web: { list: '/web-test/case-set', detail: '/web-test/case-set', create: '/web-test/case-set/new' },
  pc: { list: '/pc-test/case-set', detail: '/pc-test/case-set', create: '/pc-test/case-set/new' },
  mobile: { list: '/mobile-test/case-set', detail: '/mobile-test/case-set', create: '/mobile-test/case-set/new' },
};

export default function CaseSetList({ basePath = '/api-test', testType = 'api' }: { basePath?: string; testType?: string } = {}) {
  const navigate = useNavigate();
  const [sets, setSets] = useState<SetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  // Filter states
  const [filterName, setFilterName] = useState('');
  const [filterTags, setFilterTags] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortField, setSortField] = useState('updated_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  const apiPaths = API_PATH_MAP[testType] || API_PATH_MAP.api;
  const routePaths = ROUTE_PATH_MAP[testType] || ROUTE_PATH_MAP.api;
  const isCaseSet = testType !== 'api';
  const title = isCaseSet ? '用例集' : '场景集';

  function load() {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: sortField,
      order: sortOrder,
    });
    if (filterName) params.set('name', filterName);
    if (filterTags) params.set('tags', filterTags);
    if (filterStatus) params.set('status', filterStatus);

    apiFetch<{ items: SetItem[]; total: number }>(`${apiPaths.list}?${params}`).then(res => {
      if (res.code === 200) {
        setSets(res.data?.items || []);
        setTotal(res.data?.total || 0);
      }
    }).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [page, pageSize, filterName, filterTags, filterStatus, sortField, sortOrder]);

  async function doDelete(id: number, name: string) {
    if (!confirm(`确认删除「${name}」？`)) return;
    await apiFetch(`${apiPaths.delete}/${id}`, { method: 'DELETE' });
    load();
  }

  function handleCreate() {
    navigate(routePaths.create);
  }

  function handleReset() {
    setFilterName('');
    setFilterTags('');
    setFilterStatus('');
    setPage(1);
  }

  function handleQuery() {
    setPage(1);
    load();
  }

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
      {/* Filter bar */}
      <div className="alist-filter">
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>{title}名称</label>
            <input
              placeholder="搜索名称"
              value={filterName}
              onChange={e => setFilterName(e.target.value)}
              onBlur={() => handleQuery()}
            />
          </div>
          <div className="alist-filter-item">
            <label>标签</label>
            <TagFilterSelect value={filterTags} onChange={v => { setFilterTags(v); setPage(1); }} placeholder="按标签筛选" />
          </div>
          <div className="alist-filter-item">
            <label>状态</label>
            <FormSelect value={filterStatus} options={[{value:"",label:"全部"},{value:"active",label:"启用"},{value:"disabled",label:"禁用"},{value:"draft",label:"草稿"}]} onChange={val => { setFilterStatus(val); setPage(1); }} />
          </div>
          <div className="alist-filter-actions">
            <button className="btn btn-default" onClick={() => { handleReset(); load(); }}>重置</button>
            <button className="btn btn-primary" onClick={handleCreate}>新增</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="alist-table-wrap">
        {loading ? (
          <div className="alist-empty">加载中...</div>
        ) : sets.length === 0 ? (
          <div className="alist-empty">暂无数据</div>
        ) : (
          <table className="alist-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort('name')}>{title}名称 {sortIcon('name')}</th>
                <th>标签</th>
                <th>状态</th>
                <th>执行统计</th>
                <th>最近执行时间</th>
                <th className="sortable" onClick={() => toggleSort('created_at')}>创建时间 {sortIcon('created_at')}</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {sets.map(s => {
                const statusInfo = STATUS_MAP[s.status] || { label: s.status, color: '#999' };
                const tagList = s.tags ? s.tags.split(',').filter(Boolean) : [];
                return (
                  <tr
                    key={s.id}
                    onClick={() => navigate(`${routePaths.list}/${s.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{s.name}</td>
                    <td>
                      {tagList.length > 0 ? (
                        tagList.map((t, i) => <span key={i} className="sslist-tag">{t.trim()}</span>)
                      ) : '-'}
                    </td>
                    <td>
                      <span className="sslist-status" style={{ color: statusInfo.color }}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td>
                      {s.execution_summary ? (
                        <span style={{ fontSize: 13 }}>
                          <span style={{ color: '#999' }}>{s.execution_summary.total - s.execution_summary.passed - s.execution_summary.failed}</span>
                          <span style={{ color: '#52c41a' }}>/{s.execution_summary.passed}</span>
                          <span style={{ color: '#ff4d4f' }}>/{s.execution_summary.failed}</span>
                        </span>
                      ) : (
                        <span style={{ color: '#999', fontSize: 13 }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: '#666' }}>
                      {s.execution_summary ? formatDateTime(s.execution_summary.last_executed_at) : '—'}
                    </td>
                    <td>{formatDateTime(s.created_at)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="row-action-btn row-action-del" title="删除" onClick={(e) => { e.stopPropagation(); doDelete(s.id, s.name); }}>✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
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
