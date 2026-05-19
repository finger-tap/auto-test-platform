import { useState, useEffect, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import './ScheduleList.css';

interface ScheduleSetItem {
  id: number;
  scenario_id: number;
  scenario_name: string;
  scenario_description: string | null;
  creator_name: string;
  cron_expr: string | null;
  status: 'none' | 'paused' | 'active';
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<string, string> = { none: '未设置', paused: '暂停', active: '正常' };
const CRON_PRESETS = [
  { label: '每天 7:30', value: '30 7 * * *' },
  { label: '每天 9:00', value: '0 9 * * *' },
  { label: '工作日 9:00', value: '0 9 * * 1-5' },
  { label: '每周一 9:00', value: '0 9 * * 1' },
  { label: '每月 1 日 9:00', value: '0 9 1 * *' },
  { label: '每小时', value: '0 * * * *' },
];

// Inline schedule config modal
function InlineScheduleConfig({ item, onClose, onUpdated }: {
  item: ScheduleSetItem;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [cronExpr, setCronExpr] = useState(item.cron_expr || '0 7 * * *');
  const [minute, setMinute] = useState('0');
  const [hour, setHour] = useState('7');
  const [day, setDay] = useState('*');
  const [month, setMonth] = useState('*');
  const [dow, setDow] = useState('*');
  const [status, setStatus] = useState<'none' | 'paused' | 'active'>(item.status);
  const [saving, setSaving] = useState(false);
  const [modalMsg, setModalMsg] = useState('');
  const [modalType, setModalType] = useState<'success' | 'error'>('success');
  const [modalOpen, setModalOpen] = useState(false);

  const MIN_OPTS = ['*', '0', '15', '30', '45'];
  const HOUR_OPTS = ['*', ...Array.from({ length: 24 }, (_, i) => String(i))];
  const DAY_OPTS = ['*', ...Array.from({ length: 31 }, (_, i) => String(i + 1))];
  const MON_OPTS = ['*', ...Array.from({ length: 12 }, (_, i) => String(i + 1))];
  const DOW_OPTS = ['*', '0', '1', '2', '3', '4', '5', '6'];
  const DOW_LABELS: Record<string, string> = { '*': '每天', '0': '周日', '1': '周一', '2': '周二', '3': '周三', '4': '周四', '5': '周五', '6': '周六' };

  useEffect(() => {
    if (item.cron_expr) parseCron(item.cron_expr);
  }, [item.cron_expr]);

  function parseCron(expr: string) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length >= 5) {
      setMinute(parts[0]); setHour(parts[1]); setDay(parts[2]);
      setMonth(parts[3]); setDow(parts[4]); setCronExpr(expr);
    }
  }

  function buildCron() { return `${minute} ${hour} ${day} ${month} ${dow}`; }
  function applyPreset(v: string) { setCronExpr(v); parseCron(v); }
  function applyFromFields() { setCronExpr(buildCron()); }

  async function doSave(enableImmediately: boolean) {
    if (status !== 'none' && !cronExpr) { setModalType('error'); setModalMsg('请选择执行时间'); setModalOpen(true); return; }
    setSaving(true);
    try {
      const body = { cron_expr: cronExpr, status: enableImmediately ? 'active' : status };
      let res;
      if (item.id > 0) {
        res = await apiFetch(`/schedules/${item.id}/configure`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        res = await apiFetch(`/schedules/scenario/${item.scenario_id}`, { method: 'PUT', body: JSON.stringify(body) });
      }
      const data = await res;
      setSaving(false);
      if (data.code === 200) {
        setModalType('success'); setModalMsg(enableImmediately ? '已保存并启用' : '保存成功'); setModalOpen(true);
        setTimeout(() => { onUpdated(); onClose(); }, 1500);
      } else {
        setModalType('error'); setModalMsg(data.message || '保存失败'); setModalOpen(true);
      }
    } catch {
      setSaving(false); setModalType('error'); setModalMsg('保存失败'); setModalOpen(true);
    }
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 640, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: '#1a1a1a' }}>配置定时任务</h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#999' }}>✕</button>
          </div>

          <div style={{ background: '#fafafa', borderRadius: 8, padding: '12px 16px', marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><span style={{ fontSize: 12, color: '#999' }}>场景</span><div style={{ fontSize: 14, marginTop: 2 }}>{item.scenario_name}</div></div>
            <div><span style={{ fontSize: 12, color: '#999' }}>描述</span><div style={{ fontSize: 14, marginTop: 2 }}>{item.scenario_description || '-'}</div></div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 8, fontWeight: 500 }}>常用时间</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {CRON_PRESETS.map(p => (
                <button key={p.value} onClick={() => applyPreset(p.value)}
                  style={{ padding: '4px 12px', borderRadius: 16, border: `1px solid ${cronExpr === p.value ? '#1677ff' : '#d9d9d9'}`, background: cronExpr === p.value ? '#1677ff' : '#fff', color: cronExpr === p.value ? '#fff' : '#333', cursor: 'pointer', fontSize: 13 }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 10, fontWeight: 500 }}>自定义时间</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
              {[
                { label: '分', opts: MIN_OPTS, val: minute, set: setMinute },
                { label: '时', opts: HOUR_OPTS, val: hour, set: setHour },
                { label: '日', opts: DAY_OPTS, val: day, set: setDay },
                { label: '月', opts: MON_OPTS, val: month, set: setMonth },
                { label: '周', opts: DOW_OPTS, val: dow, set: setDow },
              ].map(f => (
                <div key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#666' }}>{f.label}</span>
                  <select value={f.val} onChange={e => { f.set(e.target.value); applyFromFields(); }}
                    style={{ padding: '5px 8px', border: '1px solid #d9d9d9', borderRadius: 6, minWidth: 70 }}>
                    {f.opts.map(o => <option key={o} value={o}>{o === '*' ? `每${f.label}` : (f.label === '周' ? DOW_LABELS[o] || o : o)}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fff', borderRadius: 6, border: '1px solid #e8e8e8' }}>
              <span style={{ fontSize: 12, color: '#999' }}>表达式</span>
              <code style={{ fontSize: 13, fontFamily: 'Courier New', color: '#1677ff', background: '#e6f4ff', padding: '2px 6px', borderRadius: 3 }}>{cronExpr}</code>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <span style={{ fontSize: 14, color: '#333' }}>任务状态</span>
            <select value={status} onChange={e => setStatus(e.target.value as typeof status)}
              style={{ padding: '6px 12px', border: '1px solid #d9d9d9', borderRadius: 6, minWidth: 140 }}>
              <option value="none">未设置</option>
              <option value="paused">暂停</option>
              <option value="active">正常</option>
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '8px 20px', border: '1px solid #d9d9d9', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 14 }}>取消</button>
            <button onClick={() => doSave(true)} disabled={saving}
              style={{ padding: '8px 20px', border: 'none', borderRadius: 6, background: '#1677ff', color: '#fff', cursor: 'pointer', fontSize: 14, opacity: saving ? 0.6 : 1 }}>
              保存并启用
            </button>
          </div>
        </div>
      </div>

      {/* Message Toast */}
      {modalOpen && (
        <div style={{
          position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '10px 24px', borderRadius: 6, fontSize: 14, zIndex: 2000,
          background: modalType === 'success' ? '#f6ffed' : '#fff2f0',
          color: modalType === 'success' ? '#52c41a' : '#ff4d4f',
          border: `1px solid ${modalType === 'success' ? '#b7eb8f' : '#ffccc7'}`,
        }}>
          {modalMsg}
        </div>
      )}
    </>
  );
}

export default function ScheduleList() {
  const navigate = useNavigate();
  const [list, setList] = useState<ScheduleSetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [floatBtn, setFloatBtn] = useState<{ x: number; y: number; item: ScheduleSetItem } | null>(null);
  const [configItem, setConfigItem] = useState<ScheduleSetItem | null>(null);
  const [nameFilter, setNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [creatorFilter, setCreatorFilter] = useState('');
  const [sortField, setSortField] = useState('updated_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const floatMenuRef = useState<React.RefObject<HTMLDivElement | null>>({} as React.RefObject<HTMLDivElement | null>)[0];

  const fetchList = async (pageNum = 1, pageSz = pageSize) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pageNum), pageSize: String(pageSz), sort: sortField, order: sortOrder });
      if (creatorFilter) params.set('creator', creatorFilter);
      const res = await apiFetch<{ items: ScheduleSetItem[]; total: number; page: number; pageSize: number }>(`/schedules?${params}`);
      if (res.code === 200 && res.data) {
        setList(res.data.items || []);
        setTotal(res.data.total || 0);
        setPage(res.data.page || 1);
        setPageSize(res.data.pageSize || 10);
      } else { setList([]); }
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchList(); }, [sortField, sortOrder]);

  // Close float on outside click
  useEffect(() => {
    if (!floatBtn) return;
    const handler = (e: MouseEvent) => {
      if (floatMenuRef.current && !(floatMenuRef.current as any)?.contains?.(e.target)) setFloatBtn(null);
    };
    setTimeout(() => document.addEventListener('click', handler as unknown as EventListener), 0);
    return () => document.removeEventListener('click', handler as unknown as EventListener);
  }, [floatBtn]);

  const handleRowClick = (e: MouseEvent, item: ScheduleSetItem) => {
    e.stopPropagation();
    setFloatBtn({ x: e.clientX, y: e.clientY, item });
  };

  const handlePause = async (item: ScheduleSetItem) => {
    setFloatBtn(null);
    if (item.id <= 0) return;
    await apiFetch(`/schedules/${item.id}/pause`, { method: 'POST' });
    fetchList(page);
  };

  const handleResume = async (item: ScheduleSetItem) => {
    setFloatBtn(null);
    if (item.id <= 0) return;
    await apiFetch(`/schedules/${item.id}/resume`, { method: 'POST' });
    fetchList(page);
  };

  const handleRemove = async (item: ScheduleSetItem) => {
    setFloatBtn(null);
    if (item.id <= 0) return;
    if (!confirm(`确认移除「${item.scenario_name}」的定时配置？`)) return;
    await apiFetch(`/schedules/${item.id}/remove`, { method: 'POST' });
    fetchList(page);
  };

  const filtered = list.filter(item => {
    if (nameFilter && !item.scenario_name.includes(nameFilter)) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    if (creatorFilter && !(item.creator_name || '').includes(creatorFilter)) return false;
    return true;
  });

  const getBadgeClass = (status: string) => {
    if (status === 'active') return 'schedule-status-badge status-active';
    if (status === 'paused') return 'schedule-status-badge status-paused';
    return 'schedule-status-badge status-none';
  };

  const handleReset = () => { setNameFilter(''); setStatusFilter(''); setCreatorFilter(''); fetchList(1); };
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
            <label>场景名称</label>
            <input placeholder="搜索名称" value={nameFilter} onChange={e => setNameFilter(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>创建人</label>
            <input placeholder="创建人" value={creatorFilter} onChange={e => setCreatorFilter(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>状态</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">全部状态</option>
              <option value="none">未设置</option>
              <option value="paused">暂停</option>
              <option value="active">正常</option>
            </select>
          </div>
          <div className="alist-filter-actions">
            <button className="alist-btn-query" onClick={handleReset}>重置</button>
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
                <th>创建人</th>
                <th>任务状态</th>
                <th className="sortable" onClick={() => toggleSort('next_run_at')}>下次执行时间 {sortIcon('next_run_at')}</th>
                <th className="sortable" onClick={() => toggleSort('last_run_at')}>最近执行 {sortIcon('last_run_at')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr
                  key={item.scenario_id}
                  onClick={e => handleRowClick(e, item)}
                  className={floatBtn?.item.scenario_id === item.scenario_id ? 'active-row' : ''}
                >
                  <td>{item.scenario_name}</td>
                  <td>{item.creator_name}</td>
                  <td><span className={getBadgeClass(item.status)}>{STATUS_LABELS[item.status]}</span></td>
                  <td className="td-next-run">{item.status === 'active' && item.next_run_at ? item.next_run_at : '—'}</td>
                  <td className="td-next-run">{item.last_run_at ? item.last_run_at.replace('T', ' ').slice(0, 16) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="alist-pagination">
        <span className="page-info">共 {total} 条，第 {page} / {Math.ceil(total / pageSize) || 1} 页</span>
        <button className="page-btn" disabled={page <= 1} onClick={() => fetchList(page - 1)}>上一页</button>
        <button className="page-btn" disabled={page >= Math.ceil(total / pageSize) || total === 0} onClick={() => fetchList(page + 1)}>下一页</button>
        <select className="page-size-select" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); fetchList(1); }}>
          <option value={10}>10条/页</option>
          <option value={20}>20条/页</option>
          <option value={50}>50条/页</option>
          <option value={100}>100条/页</option>
        </select>
      </div>

      {/* Floating action buttons */}
      {floatBtn && (
        <div
          ref={floatMenuRef as React.RefObject<HTMLDivElement>}
          className="alist-float"
          style={{ left: floatBtn.x, top: floatBtn.y }}
          onClick={e => e.stopPropagation()}>
          <button className="alist-float-btn" style={{ color: '#1677ff' }} onClick={() => { setFloatBtn(null); navigate(`/api-test/scene-case/${floatBtn.item.scenario_id}`); }}>
            查看场景集
          </button>
          <button className="alist-float-btn" style={{ color: '#1677ff' }} onClick={() => { setFloatBtn(null); setConfigItem(floatBtn.item); }}>
            配置
          </button>
          {floatBtn.item.status === 'active' && (
            <button className="alist-float-btn" style={{ color: '#fa8c16' }} onClick={() => handlePause(floatBtn.item)}>暂停</button>
          )}
          {floatBtn.item.status === 'paused' && (
            <button className="alist-float-btn" style={{ color: '#52c41a' }} onClick={() => handleResume(floatBtn.item)}>启用</button>
          )}
          {floatBtn.item.id > 0 && (
            <button className="alist-float-btn" style={{ color: '#ff4d4f' }} onClick={() => handleRemove(floatBtn.item)}>移除配置</button>
          )}
        </div>
      )}

      {/* Inline schedule config */}
      {configItem && (
        <InlineScheduleConfig
          item={configItem}
          onClose={() => setConfigItem(null)}
          onUpdated={() => fetchList(page)}
        />
      )}
    </div>
  );
}