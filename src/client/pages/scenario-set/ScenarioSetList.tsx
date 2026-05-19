import { useState, useEffect, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import './ScenarioSetList.css';

interface SetItem {
  id: number;
  name: string;
  description: string | null;
  tags: string;
  status: string;
  scenario_count: number;
  created_at: string;
  updated_at: string;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  active: { label: '启用', color: '#52c41a' },
  disabled: { label: '禁用', color: '#999' },
  draft: { label: '草稿', color: '#faad14' },
};

export default function ScenarioSetList() {
  const navigate = useNavigate();
  const [sets, setSets] = useState<SetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [floatBtn, setFloatBtn] = useState<{ id: number; x: number; y: number } | null>(null);

  // Filter states
  const [filterName, setFilterName] = useState('');
  const [filterTags, setFilterTags] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortField, setSortField] = useState('updated_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

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

    apiFetch<{ items: SetItem[]; total: number }>(`/scenario-sets?${params}`).then(res => {
      if (res.code === 200) {
        setSets(res.data?.items || []);
        setTotal(res.data?.total || 0);
      }
    }).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [page, pageSize, filterName, filterTags, filterStatus, sortField, sortOrder]);

  useEffect(() => {
    const handler = () => setFloatBtn(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  async function doDelete(id: number, name: string) {
    if (!confirm(`确认删除场景集「${name}」？`)) return;
    setFloatBtn(null);
    await apiFetch(`/scenario-sets/${id}`, { method: 'DELETE' });
    load();
  }

  function handleRowClick(e: MouseEvent, id: number) {
    e.stopPropagation();
    setFloatBtn({ id, x: e.clientX, y: e.clientY });
  }

  function handleCreate() {
    navigate('/api-test/scene-set/new');
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

  function handleAdd() {
    setPage(1);
    handleQuery();
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
            <label>场景集名称</label>
            <input
              placeholder="搜索名称"
              value={filterName}
              onChange={e => setFilterName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleQuery()}
            />
          </div>
          <div className="alist-filter-item">
            <label>标签</label>
            <input
              placeholder="标签"
              value={filterTags}
              onChange={e => setFilterTags(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleQuery()}
            />
          </div>
          <div className="alist-filter-item">
            <label>状态</label>
            <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
              <option value="">全部</option>
              <option value="active">启用</option>
              <option value="disabled">禁用</option>
              <option value="draft">草稿</option>
            </select>
          </div>
          <div className="alist-filter-actions">
            <button className="alist-btn-query" onClick={handleReset}>重置</button>
            <button className="alist-btn-add" onClick={handleAdd}>查询</button>
            <button className="alist-btn-add" onClick={handleCreate}>新增</button>
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
                <th className="sortable" onClick={() => toggleSort('name')}>场景集名称 {sortIcon('name')}</th>
                <th>标签</th>
                <th>状态</th>
                <th>包含场景数</th>
                <th className="sortable" onClick={() => toggleSort('created_at')}>创建时间 {sortIcon('created_at')}</th>
                <th className="sortable" onClick={() => toggleSort('updated_at')}>更新时间 {sortIcon('updated_at')}</th>
              </tr>
            </thead>
            <tbody>
              {sets.map(s => {
                const statusInfo = STATUS_MAP[s.status] || { label: s.status, color: '#999' };
                const tagList = s.tags ? s.tags.split(',').filter(Boolean) : [];
                return (
                  <tr
                    key={s.id}
                    onClick={e => handleRowClick(e, s.id)}
                    className={floatBtn?.id === s.id ? 'active-row' : ''}
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
                    <td>{s.scenario_count} 个场景</td>
                    <td>{s.created_at.replace('T', ' ').slice(0, 16)}</td>
                    <td>{s.updated_at.replace('T', ' ').slice(0, 16)}</td>
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
        <button className="page-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
        <button className="page-btn" disabled={page >= Math.ceil(total / pageSize) || total === 0} onClick={() => setPage(p => p + 1)}>下一页</button>
        <select className="page-size-select" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
          <option value={10}>10条/页</option>
          <option value={20}>20条/页</option>
          <option value={50}>50条/页</option>
          <option value={100}>100条/页</option>
        </select>
      </div>

      {/* Floating Action Buttons */}
      {floatBtn && (
        <div
          className="alist-float"
          style={{ left: floatBtn.x, top: floatBtn.y }}
          onClick={e => e.stopPropagation()}>
          <button className="alist-float-btn alist-float-view" onClick={() => { setFloatBtn(null); navigate(`/api-test/scene-set/${floatBtn.id}`); }}>
            查看
          </button>
          <button className="alist-float-btn alist-float-del" onClick={() => doDelete(floatBtn.id, sets.find(s => s.id === floatBtn.id)?.name || '')}>
            删除
          </button>
        </div>
      )}
    </div>
  );
}