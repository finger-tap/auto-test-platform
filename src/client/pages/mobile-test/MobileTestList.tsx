import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import TagFilterSelect from '../../components/TagFilterSelect';
import FormSelect from '../../components/FormSelect';
import CollapsibleFilter, { FilterItem } from '../../components/CollapsibleFilter';
import { useTagColors, tagBadgeStyle } from '../../hooks/useTagColors';
import '../../pages/api-test/ApiList.css';

interface MobileTestCase {
  id: number;
  name: string;
  description: string | null;
  tags: string;
  platform: string;
  device_name: string;
  status: string;
  created_at: string;
  updated_at: string;
  steps_count?: number;
}

interface ListResponse {
  items: MobileTestCase[];
  total: number;
  page: number;
  pageSize: number;
}

const PLATFORMS = [
  { value: '', label: '全部平台' },
  { value: 'android', label: 'Android' },
  { value: 'ios', label: 'iOS' },
];

const STATUSES = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

const statusLabel = (s: string) => {
  if (s === 'active') return '启用';
  if (s === 'disabled') return '禁用';
  if (s === 'draft') return '草稿';
  return s;
};

export default function MobileTestList() {
  const tagColors = useTagColors();
  const navigate = useNavigate();
  const [items, setItems] = useState<MobileTestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fTag, setFTag] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [fPlatform, setFPlatform] = useState('');
  const [sortField, setSortField] = useState('updated_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  const fetchList = (p = page, ps = pageSize) => {
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
    if (fPlatform) params.set('platform', fPlatform);
    if (fDateFrom) params.set('dateFrom', fDateFrom);
    if (fDateTo) params.set('dateTo', fDateTo);

    apiFetch<ListResponse>(`/mobile-tests?${params}`)
      .then(res => {
        if (res.code === 200 && res.data) {
          setItems(res.data.items || []);
          setTotal(res.data.total || 0);
          setPage(res.data.page);
          setPageSize(res.data.pageSize);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchList(); }, [sortField, sortOrder]);

  const handleQuery = () => {
    setPage(1);
    fetchList(1);
  };

  const handleReset = () => {
    setFName('');
    setFDesc('');
    setFTag('');
    setFStatus('');
    setFDateFrom('');
    setFDateTo('');
    setFPlatform('');
    setPage(1);
    fetchList(1);
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    const ok = await notification.confirm('确认删除此用例？');
    if (!ok) return;
    const res = await apiFetch(`/mobile-tests/${id}`, { method: 'DELETE' });
    if (res.code === 200) fetchList(page);
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
            <FilterItem label="平台">
              <FormSelect value={fPlatform} options={PLATFORMS} onChange={val => setFPlatform(val)} />
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
            <button className="btn btn-primary" onClick={() => navigate('/mobile-test/case/new')}>新增</button>
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
                <th>平台</th>
                <th>步骤数</th>
                <th>标签</th>
                <th>状态</th>
                <th className="sortable" onClick={() => toggleSort('created_at')}>创建时间 {sortIcon('created_at')}</th>
                <th className="sortable" onClick={() => toggleSort('updated_at')}>更新时间 {sortIcon('updated_at')}</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c, index) => (
                <tr key={c.id} className="row-enter" style={{ '--delay': `${index * 30}ms`, cursor: 'pointer' } as React.CSSProperties} onClick={() => navigate(`/mobile-test/case/${c.id}`)}>
                  <td style={{ fontWeight: 500 }}>{c.name}</td>
                  <td>
                    <span className={`status-text status-${c.platform}`}>
                      {c.platform === 'ios' ? 'iOS' : c.platform === 'harmony' ? 'Harmony' : 'Android'}
                    </span>
                  </td>
                  <td className="td-mono" style={{ fontFamily: 'var(--font-mono)' }}>{c.steps_count ?? 0}</td>
                  <td>
                    {c.tags ? c.tags.split(',').filter(Boolean).map(t => (
                      <span key={t} className="tag-badge" style={tagBadgeStyle(tagColors.get(t.trim()) || '')}>{t.trim()}</span>
                    )) : '-'}
                  </td>
                  <td><span className={`status-text status-${c.status}`}>{statusLabel(c.status)}</span></td>
                  <td>{formatDateTime(c.created_at)}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{formatDateTime(c.updated_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" title="执行" onClick={e => { e.stopPropagation(); navigate(`/mobile-test/case/${c.id}?autoExecute=1`); }}>执行</button>
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
        <FormSelect value={String(pageSize)} options={[{value:"10",label:"10条/页"},{value:"20",label:"20条/页"},{value:"50",label:"50条/页"},{value:"100",label:"100条/页"}]} onChange={val => fetchList(1, Number(val))} />
      </div>
    </div>
  );
}
