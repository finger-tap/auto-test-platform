import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, is2xx } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import TagFilterSelect from '../../components/TagFilterSelect';
import FormSelect from '../../components/FormSelect';
import PageSizeSelect from '../../components/PageSizeSelect';
import CollapsibleFilter, { FilterItem } from '../../components/CollapsibleFilter';
import { useTagColors, tagBadgeStyle } from '../../hooks/useTagColors';
import '../../pages/api-test/ApiList.css';
import { useViewportPageSize } from '../../hooks/useViewportPageSize';

interface CaseItem {
  id: number;
  name: string;
  description: string | null;
  tags: string;
  browser: string;
  steps: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  items: CaseItem[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUSES = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

const BROWSERS = [
  { value: '', label: '全部浏览器' },
  { value: 'chromium', label: 'Chromium' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'webkit', label: 'WebKit' },
];

const statusLabel = (s: string) => {
  if (s === 'active') return '启用';
  if (s === 'disabled') return '禁用';
  if (s === 'draft') return '草稿';
  return s;
};

export default function WebCaseList() {
  const tagColors = useTagColors();
  const navigate = useNavigate();
  const [items, setItems] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  // 每页行数自适应视口: 按表格容器真实高度算, 保证表格恰好填满一屏不滚动;
  // 用户在分页条手动选择条数后以手动值为准。
  const [autoPageSize, tableWrapRef] = useViewportPageSize();
  const [userPageSize, setUserPageSize] = useState<number | null>(null);
  const pageSize = userPageSize ?? autoPageSize;
  const setPageSize = setUserPageSize;
  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fTag, setFTag] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fBrowser, setFBrowser] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [sortField, setSortField] = useState('updated_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  const fetchSeq = useRef(0);
  const fetchList = (p = page, ps = pageSize) => {
    // 竞态守卫: 仅最新一次请求的响应可以落地(StrictMode/行数校准都会并发重拉)
    const seq = ++fetchSeq.current;
    setLoading(true);
    const params = new URLSearchParams({
      page: String(p),
      pageSize: String(ps),
      sort: sortField,
      order: sortOrder,
    });
    if (fName) params.set('name', fName);
    if (fDesc) params.set('description', fDesc);
    if (fTag) params.set('tag', fTag);
    if (fStatus) params.set('status', fStatus);
    if (fBrowser) params.set('browser', fBrowser);
    if (fDateFrom) params.set('dateFrom', fDateFrom);
    if (fDateTo) params.set('dateTo', fDateTo);

    apiFetch<ListResponse>(`/web-cases?${params}`)
      .then(res => {
        if (seq !== fetchSeq.current) return;
        if (is2xx(res.code) && res.data) {
          setItems(res.data.items || []);
          setTotal(res.data.total || 0);
          setPage(res.data.page);
        }
      })
      .catch(() => {})
      .finally(() => { if (seq === fetchSeq.current) setLoading(false); });
  };

  useEffect(() => { fetchList(); }, [sortField, sortOrder]);

  // 每页条数变化(视口自适应/手动选择)时刷新; 首次由上面的 effect 拉取, 跳过
  const sizeFirstRun = useRef(true);
  useEffect(() => {
    if (sizeFirstRun.current) { sizeFirstRun.current = false; return; }
    fetchList();
  }, [pageSize]);

  const handleQuery = () => {
    setPage(1);
    fetchList(1);
  };

  const handleReset = () => {
    setFName('');
    setFDesc('');
    setFTag('');
    setFStatus('');
    setFBrowser('');
    setFDateFrom('');
    setFDateTo('');
    setPage(1);
    fetchList(1);
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    const ok = await notification.confirm('确认删除此用例？');
    if (!ok) return;
    const res = await apiFetch(`/web-cases/${id}`, { method: 'DELETE' });
    if (is2xx(res.code)) fetchList(page);
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
      <CollapsibleFilter
        primary={
          <>
            <FilterItem label="用例名称">
              <input placeholder="搜索名称..." value={fName} onChange={e => setFName(e.target.value)} />
            </FilterItem>
            <FilterItem label="标签">
              <TagFilterSelect value={fTag} onChange={v => setFTag(v)} placeholder="按标签筛选" />
            </FilterItem>
            <FilterItem label="状态">
              <FormSelect value={fStatus} options={STATUSES} onChange={val => setFStatus(val)} />
            </FilterItem>
          </>
        }
        advanced={
          <>
            <FilterItem label="描述">
              <input placeholder="搜索描述..." value={fDesc} onChange={e => setFDesc(e.target.value)} />
            </FilterItem>
            <FilterItem label="浏览器">
              <FormSelect value={fBrowser} options={BROWSERS} onChange={val => setFBrowser(val)} />
            </FilterItem>
            <FilterItem label="创建时间起">
              <input type="date" value={fDateFrom} onChange={e => setFDateFrom(e.target.value)} />
            </FilterItem>
            <FilterItem label="创建时间止">
              <input type="date" value={fDateTo} onChange={e => setFDateTo(e.target.value)} />
            </FilterItem>
          </>
        }
        actions={
          <>
            <button className="btn btn-default" onClick={handleReset}>重置</button>
            <button className="btn btn-primary" onClick={handleQuery}>查询</button>
            <button className="btn btn-primary" onClick={() => navigate('/web-test/case/new')}>新增</button>
          </>
        }
      />

      <div className="alist-table-wrap" ref={tableWrapRef}>
        {loading ? (
          <div className="alist-empty">加载中...</div>
        ) : items.length === 0 && total === 0 ? (
          <div className="alist-empty">
            <p>暂无Web 用例</p>
            <p className="alist-empty-hint">创建第一个用例，开始你的自动化测试</p>
            <button className="sset-btn-create" onClick={() => navigate('/web-test/case/new')}>+ 新建第一个用例</button>
          </div>
        ) : items.length === 0 ? (
          <div className="alist-empty">
            <p>没有匹配的用例</p>
            <p className="alist-empty-hint">换个关键词试试，或点击「重置」清空筛选条件</p>
          </div>
        ) : (
          <table className="alist-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort('name')}>名称 {sortIcon('name')}</th>
                <th style={{ width: 84 }}>浏览器</th>
                <th style={{ width: 184 }}>标签</th>
                <th style={{ width: 72 }}>步骤数</th>
                <th style={{ width: 72 }}>状态</th>
                <th className="sortable" style={{ width: 152 }} onClick={() => toggleSort('created_at')}>创建时间 {sortIcon('created_at')}</th>
                <th className="sortable" style={{ width: 152 }} onClick={() => toggleSort('updated_at')}>更新时间 {sortIcon('updated_at')}</th>
                <th style={{ width: 124 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c, index) => (
                <tr key={c.id} className="row-enter" style={{ '--delay': `${index * 30}ms`, cursor: 'pointer' } as React.CSSProperties} onClick={() => navigate(`/web-test/case/${c.id}`)}>
                  <td className="td-name" style={{ fontWeight: 500 }} title={c.name}>{c.name}</td>
                  <td>
                    <span className={`status-text status-${c.browser || 'chromium'}`}>
                      {c.browser === 'firefox' ? 'Firefox' : c.browser === 'webkit' ? 'WebKit' : 'Chromium'}
                    </span>
                  </td>
                  <td className="td-tags" title={c.tags || undefined}>
                    {c.tags ? c.tags.split(',').filter(Boolean).map(t => (
                      <span key={t} className="tag-badge" style={tagBadgeStyle(tagColors.get(t.trim()) || '')}>{t.trim()}</span>
                    )) : '-'}
                  </td>
                  <td className="td-mono" style={{ fontFamily: 'var(--font-mono)' }}>{c.steps ?? 0}</td>
                  <td><span className={`status-text status-${c.status}`}>{statusLabel(c.status)}</span></td>
                  <td>{formatDateTime(c.created_at)}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{formatDateTime(c.updated_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" title="执行" onClick={e => { e.stopPropagation(); navigate(`/web-test/case/${c.id}?exec=1`); }}>执行</button>
                      <button className="row-action-btn row-action-del" title="删除" onClick={e => handleDelete(e, c.id)}>删除</button>
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
        <button className="btn btn-sm" disabled={page >= Math.ceil(total / pageSize) || total === 0} onClick={() => fetchList(page + 1)}>下一页</button>
        <PageSizeSelect autoSize={autoPageSize} value={pageSize} onChange={n => { setPageSize(n); setPage(1); }} />
      </div>
    </div>
  );
}
