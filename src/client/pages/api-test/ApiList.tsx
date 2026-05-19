import { useState, useEffect, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import type { ApiItem } from '../../types';
import VarHoverTip from '../../components/VarHoverTip';
import OpenAPIImportModal from '../openapi/OpenAPIImportModal';
import OpenAPIExportModal from '../openapi/OpenAPIExportModal';
import './ApiList.css';

const STATUSES = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

export default function ApiList() {
  const [apis, setApis] = useState<ApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Filter state
  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fTags, setFTags] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [sortField, setSortField] = useState('updated_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  // Floating action buttons
  const [floatBtn, setFloatBtn] = useState<{ id: number; x: number; y: number } | null>(null);

  const navigate = useNavigate();

  const fetchApis = async (pageNum = 1, pageSz = pageSize) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: String(pageNum), pageSize: String(pageSz), sort: sortField, order: sortOrder });
      const res = await apiFetch<{ items: ApiItem[]; total: number; page: number; pageSize: number }>(`/apis?${params}`);
      const r = res as { code: number; data?: { items: ApiItem[]; total: number; page: number; pageSize: number } };
      if (r.code === 200 && r.data) {
        setApis(r.data.items);
        setTotal(r.data.total);
        setPage(r.data.page);
        setPageSize(r.data.pageSize);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchApis(); }, [sortField, sortOrder]);

  // Close floating buttons on outside click
  useEffect(() => {
    const handler = () => setFloatBtn(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const handleRowClick = (e: MouseEvent, id: number) => {
    e.stopPropagation();
    setFloatBtn({ id, x: e.clientX, y: e.clientY });
  };

  const handleCreate = () => {
    navigate('/api-test/api-case/new');
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此接口？')) return;
    await apiFetch(`/apis/${id}`, { method: 'DELETE' });
    setFloatBtn(null);
    fetchApis(page);
  };

  const filtered = apis.filter((api) => {
    if (fStatus && api.status !== fStatus) return false;
    if (fName) {
      const s = fName.toLowerCase();
      if (!api.name.toLowerCase().includes(s) && !api.url.toLowerCase().includes(s)) return false;
    }
    if (fDesc && !(api.description || '').toLowerCase().includes(fDesc.toLowerCase())) return false;
    if (fTags && !(api.tags || '').toLowerCase().includes(fTags.toLowerCase())) return false;
    if (fDateFrom && api.created_at < fDateFrom) return false;
    if (fDateTo && api.created_at > fDateTo + 'T23:59:59') return false;
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

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(a => a.id)));
  };
  const toggleSelectOne = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <div className="alist">
      {/* Filter Area */}
      <div className="alist-filter">
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>接口名称</label>
            <input placeholder="搜索名称或URL" value={fName} onChange={(e) => setFName(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>描述</label>
            <input placeholder="搜索描述" value={fDesc} onChange={(e) => setFDesc(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>标签</label>
            <input placeholder="搜索标签" value={fTags} onChange={(e) => setFTags(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>状态</label>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>创建时间起</label>
            <input type="date" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>创建时间止</label>
            <input type="date" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} />
          </div>
          <div className="alist-actions">
            <button className="alist-btn-query">查询</button>
            <button className="alist-btn-add" onClick={handleCreate}>新增</button>
            <OpenAPIImportModal onImported={() => fetchApis(page)} />
            <OpenAPIExportModal selectedIds={[...selectedIds]} onExported={() => setSelectedIds(new Set())} />
            {selectedIds.size > 0 && (
              <button className="ad-btn ad-btn-sm" style={{ color: '#ff4d4f' }} onClick={() => setSelectedIds(new Set())}>
                已选 {selectedIds.size} 个
              </button>
            )}
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
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} />
                </th>
                <th className="sortable" onClick={() => toggleSort('name')}>接口名称 {sortIcon('name')}</th>
                <th>方法</th>
                <th className="sortable" onClick={() => toggleSort('url')}>URL {sortIcon('url')}</th>
                <th>标签</th>
                <th>状态</th>
                <th className="sortable" onClick={() => toggleSort('created_at')}>创建时间 {sortIcon('created_at')}</th>
                <th className="sortable" onClick={() => toggleSort('updated_at')}>更新时间 {sortIcon('updated_at')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((api) => (
                <tr key={api.id} onClick={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') handleRowClick(e, api.id); }} className={floatBtn?.id === api.id ? 'active-row' : ''}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(api.id)} onChange={() => toggleSelectOne(api.id)} />
                  </td>
                  <td>{api.name}</td>
                  <td><span className={`method-badge method-${api.method}`}>{api.method}</span></td>
                  <td className="td-url"><VarHoverTip text={api.url} /></td>
                  <td>
                    {api.tags ? api.tags.split(',').filter(Boolean).map((t) => (
                      <span key={t} className="tag-badge">{t.trim()}</span>
                    )) : '-'}
                  </td>
                  <td><span className={`status-text status-${api.status}`}>{statusLabel(api.status)}</span></td>
                  <td>{api.created_at.replace('T', ' ').slice(0, 16)}</td>
                  <td>{api.updated_at.replace('T', ' ').slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="alist-pagination">
        <span className="page-info">共 {total} 条，第 {page} / {Math.ceil(total / pageSize)} 页</span>
        <button className="page-btn" disabled={page <= 1} onClick={() => fetchApis(page - 1)}>上一页</button>
        <button className="page-btn" disabled={page >= Math.ceil(total / pageSize)} onClick={() => fetchApis(page + 1)}>下一页</button>
        <select className="page-size-select" value={pageSize} onChange={e => fetchApis(1, Number(e.target.value))}>
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
          onClick={(e) => e.stopPropagation()}
        >
          <button className="alist-float-btn alist-float-view" onClick={() => { setFloatBtn(null); navigate(`/api-test/api-case/${floatBtn.id}`); }}>
            查看
          </button>
          <button className="alist-float-btn alist-float-exec" onClick={() => { setFloatBtn(null); navigate(`/api-test/api-case/${floatBtn.id}?exec=1`); }}>
            执行
          </button>
          <button className="alist-float-btn alist-float-del" onClick={() => handleDelete(floatBtn.id)}>
            删除
          </button>
        </div>
      )}

    </div>
  );
}
