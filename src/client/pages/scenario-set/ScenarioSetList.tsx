import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, is2xx } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import TagFilterSelect from '../../components/TagFilterSelect';
import FormSelect from '../../components/FormSelect';
import PageSizeSelect from '../../components/PageSizeSelect';
import { useTagColors, tagBadgeStyle } from '../../hooks/useTagColors';
import './ScenarioSetList.css';
import { useViewportPageSize } from '../../hooks/useViewportPageSize';

interface SetItem {
  id: number;
  name: string;
  description: string | null;
  tags: string;
  status: string;
  scenario_count: number;
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

const API_PATH_MAP: Record<string, { list: string; delete: string }> = {
  api: { list: '/scenario-sets', delete: '/scenario-sets' },
  web: { list: '/scenario-sets-web', delete: '/scenario-sets-web' },
  pc: { list: '/scenario-sets-pc', delete: '/scenario-sets-pc' },
  mobile: { list: '/scenario-sets-mobile', delete: '/scenario-sets-mobile' },
};

const ROUTE_PATH_MAP: Record<string, { list: string; detail: string; create: string }> = {
  api: { list: '/api-test/case-set', detail: '/api-test/case-set', create: '/api-test/case-set/new' },
  web: { list: '/web-test/case-set', detail: '/web-test/case-set', create: '/web-test/case-set/new' },
  pc: { list: '/pc-test/case-set', detail: '/pc-test/case-set', create: '/pc-test/case-set/new' },
  mobile: { list: '/mobile-test/case-set', detail: '/mobile-test/case-set', create: '/mobile-test/case-set/new' },
};

export default function ScenarioSetList({ basePath = '/api-test', testType = 'api' }: { basePath?: string; testType?: string } = {}) {
  const navigate = useNavigate();
  const tagColors = useTagColors();
  const [sets, setSets] = useState<SetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  // 每页行数自适应视口: 按表格容器真实高度算, 保证表格恰好填满一屏不滚动;
  // 用户在分页条手动选择条数后以手动值为准。
  const [autoPageSize, tableWrapRef] = useViewportPageSize();
  const [userPageSize, setUserPageSize] = useState<number | null>(null);
  const pageSize = userPageSize ?? autoPageSize;
  const setPageSize = setUserPageSize;
  const [total, setTotal] = useState(0);
  // Filter states
  const [filterName, setFilterName] = useState('');
  const [filterTags, setFilterTags] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortField, setSortField] = useState('updated_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [forceLoad, setForceLoad] = useState(0);

  const apiPaths = API_PATH_MAP[testType] || API_PATH_MAP.api;
  const routePaths = ROUTE_PATH_MAP[testType] || ROUTE_PATH_MAP.api;

  const loadSeq = useRef(0);
  function load() {
    // 竞态守卫: 仅最新一次请求的响应可以落地(StrictMode/行数校准都会并发重拉)
    const seq = ++loadSeq.current;
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
      if (seq !== loadSeq.current) return;
      if (is2xx(res.code)) {
        setSets(res.data?.items || []);
        setTotal(res.data?.total || 0);
      }
    }).finally(() => { if (seq === loadSeq.current) setLoading(false); });
  }

  useEffect(() => { load(); }, [page, pageSize, sortField, sortOrder, forceLoad]);

  async function doDelete(id: number, name: string) {
    const ok = await notification.confirm(`确认删除场景集「${name}」？`);
    if (!ok) return;
    await apiFetch(`${apiPaths.delete}/${id}`, { method: 'DELETE' });
    load();
  }

  // 2026-08-29: 列表直接执行 — 此前操作列只有删除, 想执行必须进详情;
  // 同步等待结果(小规模场景集毫秒~秒级), 完成后刷新执行统计列。
  const [executingId, setExecutingId] = useState<number | null>(null);
  async function doExecute(id: number, name: string) {
    if (executingId != null) return;
    setExecutingId(id);
    try {
      const res = await apiFetch<{ data?: { status: string; passed_count?: number; failed_count?: number } }>(
        `${apiPaths.list}/${id}/execute`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      const d = res.data?.data;
      if (is2xx(res.code) && d) {
        if (d.status === 'success') {
          notification.success(`「${name}」执行完成：通过 ${d.passed_count ?? 0} 个场景`);
        } else {
          notification.warning(`「${name}」执行完成：${d.passed_count ?? 0} 通过 / ${d.failed_count ?? 0} 失败 — 详情进入集合查看执行记录`);
        }
      } else {
        notification.error(res.message || '执行失败');
      }
      load();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : '执行出错');
    } finally {
      setExecutingId(null);
    }
  }

  function handleCreate() {
    navigate(routePaths.create);
  }

  function handleReset() {
    setFilterName('');
    setFilterTags('');
    setFilterStatus('');
    setPage(1);
    setForceLoad(f => f + 1);
  }

  function handleQuery() {
    setPage(1);
    setForceLoad(f => f + 1);
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
    <div className="alist page-enter">
      {/* Filter bar */}
      <div className="alist-filter">
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>场景集名称</label>
            <input
              placeholder="搜索名称"
              value={filterName}
              onChange={e => setFilterName(e.target.value)}
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
            <button className="btn btn-default" onClick={handleReset}>重置</button>
            <button className="btn btn-primary" onClick={handleQuery}>查询</button>
            <button className="btn btn-primary" onClick={handleCreate}>新增</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="alist-table-wrap" ref={tableWrapRef}>
        {loading ? (
          <div className="alist-empty">加载中...</div>
        ) : sets.length === 0 ? (
          <div className="alist-empty">
            {total === 0 ? (
              <>
                <p>暂无场景集</p>
                <p className="alist-empty-hint">把多个场景组成集合，支持批量执行与定时调度</p>
                <button className="sset-btn-create" onClick={() => navigate(`{$}{basePath}/case-set/new`)}>+ 新建第一个场景集</button>
              </>
            ) : (
              <>
                <p>没有匹配的场景集</p>
                <p className="alist-empty-hint">换个关键词试试，或点击「重置」清空筛选条件</p>
              </>
            )}
          </div>
        ) : (
          <table className="alist-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort('name')}>场景集名称 {sortIcon('name')}</th>
                <th style={{ width: 184 }}>标签</th>
                <th style={{ width: 92 }}>状态</th>
                <th style={{ width: 152 }}>执行统计</th>
                <th style={{ width: 152 }}>最近执行时间</th>
                <th className="sortable" style={{ width: 152 }} onClick={() => toggleSort('created_at')}>创建时间 {sortIcon('created_at')}</th>
                <th style={{ width: 96 }}></th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s, index) => {
                const statusInfo = STATUS_MAP[s.status] || { label: s.status, color: '#999' };
                const tagList = s.tags ? s.tags.split(',').filter(Boolean) : [];
                return (
                  <tr
                    key={s.id}
                    className="row-enter"
                    style={{ '--delay': `${index * 30}ms`, cursor: 'pointer' } as React.CSSProperties}
                    onClick={() => navigate(`${routePaths.detail}/${s.id}`)}
                  >
                    <td className="td-name" title={s.name}>{s.name}</td>
                    <td className="td-tags" title={s.tags || undefined}>
                      {tagList.length > 0 ? (
                        tagList.map((t, i) => <span key={i} className="sslist-tag" style={tagBadgeStyle(tagColors.get(t.trim()) || '')}>{t.trim()}</span>)
                      ) : '-'}
                    </td>
                    <td>
                      <span className="sslist-status" style={{ color: statusInfo.color }}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td>
                      {s.execution_summary ? (
                        // 2026-08-28: 语义化展示(原 1/0/0 三段斜杠数字无标签, 用户无法理解)
                        <span style={{ fontSize: 12, display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                          <span>共 {s.execution_summary.total}</span>
                          <span style={{ color: 'var(--success)' }}>✓ {s.execution_summary.passed}</span>
                          <span style={{ color: 'var(--danger)' }}>✗ {s.execution_summary.failed}</span>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--fg-tertiary)', fontSize: 13 }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: '#666' }}>
                      {s.execution_summary ? formatDateTime(s.execution_summary.last_executed_at) : '—'}
                    </td>
                    <td>{formatDateTime(s.created_at)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="row-action-btn" title="执行" onClick={(e) => { e.stopPropagation(); doExecute(s.id, s.name); }}>{executingId === s.id ? '执行中…' : '执行'}</button>
                        <button className="row-action-btn row-action-del" title="删除" onClick={(e) => { e.stopPropagation(); doDelete(s.id, s.name); }}>删除</button>
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
        <PageSizeSelect autoSize={autoPageSize} value={pageSize} onChange={n => { setPageSize(n); setPage(1); }} />
      </div>

    </div>
  );
}