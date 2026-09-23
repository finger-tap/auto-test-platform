import { useState, useEffect, useRef, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, is2xx } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import type { ApiItem } from '../../types';
import VarHoverTip from '../../components/VarHoverTip';
import TagFilterSelect from '../../components/TagFilterSelect';
import { useTagColors, tagBadgeStyle } from '../../hooks/useTagColors';
import FormSelect from '../../components/FormSelect';
import PageSizeSelect from '../../components/PageSizeSelect';
import CollapsibleFilter, { FilterItem } from '../../components/CollapsibleFilter';
import OpenAPIImportModal from '../openapi/OpenAPIImportModal';
import OpenAPIExportModal from '../openapi/OpenAPIExportModal';
import './ApiList.css';
import { useViewportPageSize } from '../../hooks/useViewportPageSize';

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
  // 每页行数自适应视口: 按表格容器真实高度算, 保证表格恰好填满一屏不滚动;
  // 用户在分页条手动选择条数后以手动值为准。
  const [autoPageSize, tableWrapRef] = useViewportPageSize();
  const [userPageSize, setUserPageSize] = useState<number | null>(null);
  const pageSize = userPageSize ?? autoPageSize;
  const setPageSize = setUserPageSize;
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

  const fetchSeq = useRef(0);
  const fetchApis = async (pageNum = 1, pageSz = pageSize) => {
    // 竞态守卫: 仅最新一次请求的响应可以落地(StrictMode/行数校准都会并发重拉)
    const seq = ++fetchSeq.current;
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
      if (seq !== fetchSeq.current) return;
      if (is2xx(r.code) && r.data) {
        setApis(r.data.items);
        setTotal(r.data.total);
        setPage(r.data.page);
      }
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  };

  useEffect(() => { fetchApis(); }, [sortField, sortOrder]);

  // 每页条数变化(视口自适应/手动选择)时刷新; 首次由上面的 effect 拉取, 跳过
  const sizeFirstRun = useRef(true);
  useEffect(() => {
    if (sizeFirstRun.current) { sizeFirstRun.current = false; return; }
    fetchApis(page, pageSize);
  }, [pageSize]);

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

  // 批量删除 — 勾选框此前只有导出能用, 工具条上的"已选 N 个"仅是清空选择,
  // 用户凭直觉找不到批量动作 (2026-08-27)
  const [batchDeleting, setBatchDeleting] = useState(false);
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0 || batchDeleting) return;
    const ok = await notification.confirm(`确认删除选中的 ${selectedIds.size} 个接口？删除后不可恢复。`, { type: 'danger' });
    if (!ok) return;
    setBatchDeleting(true);
    let done = 0;
    for (const id of selectedIds) {
      try {
        await apiFetch(`/apis/${id}`, { method: 'DELETE' });
        done++;
      } catch { /* 单个失败不中断剩余删除 */ }
    }
    setBatchDeleting(false);
    setSelectedIds(new Set());
    notification.success(`已删除 ${done} 个接口`);
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
              <>
                <button
                  className="btn btn-default"
                  style={{ color: '#ef4444', borderColor: '#ef4444' }}
                  disabled={batchDeleting}
                  onClick={handleBatchDelete}
                >
                  {batchDeleting ? '删除中…' : `批量删除 (${selectedIds.size})`}
                </button>
                <button className="ad-btn ad-btn-sm" style={{ color: '#ff4d4f' }} onClick={() => setSelectedIds(new Set())}>
                  取消选择
                </button>
              </>
            )}
          </>
        }
      />

      {/* Table */}
      <div className="alist-table-wrap" ref={tableWrapRef}>
        {loading ? (
          <div className="alist-empty">加载中...</div>
        ) : apis.length === 0 && total === 0 ? (
          <div className="alist-empty">
            <p>暂无接口用例</p>
            <p className="alist-empty-hint">创建第一个用例，开始你的自动化测试</p>
            <button className="sset-btn-create" onClick={() => navigate('/api-test/case/new')}>+ 新建第一个用例</button>
          </div>
        ) : apis.length === 0 ? (
          <div className="alist-empty">
            <p>没有匹配的用例</p>
            <p className="alist-empty-hint">换个关键词试试，或点击「重置」清空筛选条件</p>
          </div>
        ) : (
          <table className="alist-table">
            <thead>
              <tr>
                <th style={{ width: 52 }}>
                  <input type="checkbox" checked={selectedIds.size === apis.length && apis.length > 0} onChange={toggleSelectAll} />
                </th>
                <th className="sortable" style={{ width: 180 }} onClick={() => toggleSort('name')}>接口名称 {sortIcon('name')}</th>
                <th style={{ width: 72 }}>方法</th>
                <th className="sortable" onClick={() => toggleSort('url')}>URL {sortIcon('url')}</th>
                <th style={{ width: 160 }}>标签</th>
                <th style={{ width: 72 }}>状态</th>
                <th className="sortable" style={{ width: 152 }} onClick={() => toggleSort('created_at')}>创建时间 {sortIcon('created_at')}</th>
                <th className="sortable" style={{ width: 152 }} onClick={() => toggleSort('updated_at')}>更新时间 {sortIcon('updated_at')}</th>
                <th style={{ width: 124 }}></th>
              </tr>
            </thead>
            <tbody>
              {apis.map((api, index) => (
                <tr key={api.id} className="row-enter" style={{ '--delay': `${index * 30}ms`, cursor: 'pointer' } as React.CSSProperties} onClick={() => navigate(`/api-test/case/${api.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(api.id)} onChange={() => toggleSelectOne(api.id)} />
                  </td>
                  <td className="td-name" title={api.name}>{api.name}</td>
                  <td><span className={`method-badge method-${api.method}`}>{api.method}</span></td>
                  <td className="td-url"><VarHoverTip text={api.url} parameters={api.parameters} /></td>
                  <td className="td-tags" title={api.tags || undefined}>
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
        <span className="page-info">共 {total} 条，第 {page} / {Math.ceil(total / pageSize) || 1} 页</span>
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => fetchApis(page - 1)}>上一页</button>
        <button className="btn btn-sm" disabled={page >= Math.ceil(total / pageSize)} onClick={() => fetchApis(page + 1)}>下一页</button>
        <PageSizeSelect autoSize={autoPageSize} value={pageSize} onChange={n => { setPageSize(n); setPage(1); }} />
      </div>

    </div>
  );
}
