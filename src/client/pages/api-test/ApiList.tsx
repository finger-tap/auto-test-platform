import { useState, useEffect, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import type { ApiItem } from '../../types';
import VarHoverTip from '../../components/VarHoverTip';
import TagFilterSelect from '../../components/TagFilterSelect';
import { useTagColors, tagBadgeStyle } from '../../hooks/useTagColors';
import FormSelect from '../../components/FormSelect';
import CollapsibleFilter, { FilterItem } from '../../components/CollapsibleFilter';
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
  const tagColors = useTagColors();
  const [apis, setApis] = useState<ApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Filter state
  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [filterTags, setFilterTags] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [sortField, setSortField] = useState('updated_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  const navigate = useNavigate();

  const fetchApis = async (pageNum = 1, pageSz = pageSize) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(pageNum),
        pageSize: String(pageSz),
        sort: sortField,
        order: sortOrder,
      });
      if (fName) params.set('name', fName);
      if (fDesc) params.set('description', fDesc);
      if (filterTags) params.set('tag', filterTags);
      if (fStatus) params.set('status', fStatus);
      if (fDateFrom) params.set('dateFrom', fDateFrom);
      if (fDateTo) params.set('dateTo', fDateTo);

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

  const handleQuery = () => {
    setPage(1);
    fetchApis(1);
  };

  const handleReset = () => {
    setFName('');
    setFDesc('');
    setFilterTags('');
    setFStatus('');
    setFDateFrom('');
    setFDateTo('');
    setPage(1);
    fetchApis(1);
  };

  const handleCreate = () => {
    navigate('/api-test/case/new');
  };

  const handleDelete = async (id: number) => {
    const ok = await notification.confirm('确认删除此接口？');
    if (!ok) return;
    await apiFetch(`/apis/${id}`, { method: 'DELETE' });
    fetchApis(page);
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

  const toggleSelectAll = () => {
    if (selectedIds.size === apis.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(apis.map(a => a.id)));
  };
  const toggleSelectOne = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <div className="alist page-enter">
      {/* Filter Area */}
      <CollapsibleFilter
        primary={
          <>
            <FilterItem label="接口名称">
              <input placeholder="搜索名称或URL" value={fName} onChange={(e) => setFName(e.target.value)} />
            </FilterItem>
            <FilterItem label="标签">
              <TagFilterSelect value={filterTags} onChange={(v) => setFilterTags(v)} placeholder="按标签筛选" />
            </FilterItem>
            <FilterItem label="状态">
              <FormSelect value={fStatus} options={STATUSES} onChange={(val) => setFStatus(val)} />
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
            <OpenAPIImportModal onImported={() => fetchApis(page)} />
            <OpenAPIExportModal selectedIds={[...selectedIds]} onExported={() => setSelectedIds(new Set())} />
            {selectedIds.size > 0 && (
              <button className="ad-btn ad-btn-sm" style={{ color: '#ff4d4f' }} onClick={() => setSelectedIds(new Set())}>
                已选 {selectedIds.size} 个
              </button>
            )}
          </>
        }
      />

      {/* Table */}
      <div className="alist-table-wrap">
        {loading ? (
          <div className="alist-empty">加载中...</div>
        ) : apis.length === 0 ? (
          <div className="alist-empty">暂无数据</div>
        ) : (
          <table className="alist-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={selectedIds.size === apis.length && apis.length > 0} onChange={toggleSelectAll} />
                </th>
                <th className="sortable" onClick={() => toggleSort('name')}>接口名称 {sortIcon('name')}</th>
                <th>方法</th>
                <th className="sortable" onClick={() => toggleSort('url')}>URL {sortIcon('url')}</th>
                <th>标签</th>
                <th>状态</th>
                <th className="sortable" onClick={() => toggleSort('created_at')}>创建时间 {sortIcon('created_at')}</th>
                <th className="sortable" onClick={() => toggleSort('updated_at')}>更新时间 {sortIcon('updated_at')}</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {apis.map((api, index) => (
                <tr key={api.id} className="row-enter" style={{ '--delay': `${index * 30}ms`, cursor: 'pointer' } as React.CSSProperties} onClick={() => navigate(`/api-test/case/${api.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(api.id)} onChange={() => toggleSelectOne(api.id)} />
                  </td>
                  <td>{api.name}</td>
                  <td><span className={`method-badge method-${api.method}`}>{api.method}</span></td>
                  <td className="td-url"><VarHoverTip text={api.url} parameters={api.parameters} /></td>
                  <td>
                    {api.tags ? api.tags.split(',').filter(Boolean).map((t) => (
                      <span key={t} className="tag-badge" style={tagBadgeStyle(tagColors.get(t.trim()) || '')}>{t.trim()}</span>
                    )) : '-'}
                  </td>
                  <td><span className={`status-text status-${api.status}`}>{statusLabel(api.status)}</span></td>
                  <td>{formatDateTime(api.created_at)}</td>
                  <td>{formatDateTime(api.updated_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" title="执行" onClick={(e) => { e.stopPropagation(); navigate(`/api-test/case/${api.id}?exec=1`); }}>执行</button>
                      <button className="row-action-btn row-action-del" title="删除" onClick={(e) => { e.stopPropagation(); handleDelete(api.id); }}>删除</button>
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
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => fetchApis(page - 1)}>上一页</button>
        <button className="btn btn-sm" disabled={page >= Math.ceil(total / pageSize)} onClick={() => fetchApis(page + 1)}>下一页</button>
        <FormSelect value={String(pageSize)} options={[{value:"10",label:"10条/页"},{value:"20",label:"20条/页"},{value:"50",label:"50条/页"},{value:"100",label:"100条/页"}]} onChange={val => fetchApis(1, Number(val))} />
      </div>

    </div>
  );
}
