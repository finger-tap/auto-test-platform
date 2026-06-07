import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import FormSelect from '../../components/FormSelect';
import './ScheduleList.css';

// 2026-06-06 (#78): backend split into 4 per-type endpoints
// (/schedule-sets-api|web|pc|mobile) after the scenario→case refactor.
// The list component must talk to the right endpoint AND read the right
// field name (API keeps scenario_set_id/scenario_set_name/scenario_count;
// web/pc/mobile use case_set_id/case_set_name/case_count).
type ScheduleTestType = 'api' | 'web' | 'pc' | 'mobile';

interface ScheduleSetItem {
  id: number;
  // Exactly one of these is populated depending on testType
  scenario_set_id?: number;
  scenario_set_name?: string;
  scenario_count?: number;
  case_set_id?: number;
  case_set_name?: string;
  case_count?: number;
  creator_name: string;
  cron_expr: string | null;
  status: 'none' | 'paused' | 'active';
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
  // Stamped by fetchList — makes the rest of the file type-safe without casts.
  // The API doesn't return these; the client adds them based on the mounted
  // basePath so the modal/buttons can use the right endpoint.
  testType?: ScheduleTestType;
  setId?: number;
  setName?: string;
  setCount?: number;
}

// Resolve per-type config from the current basePath. basePath is the
// React Router base the page is mounted at (e.g. /api-test, /web-test).
function resolveType(basePath: string): ScheduleTestType {
  if (basePath.startsWith('/api-test')) return 'api';
  if (basePath.startsWith('/web-test')) return 'web';
  if (basePath.startsWith('/pc-test')) return 'pc';
  return 'mobile';
}

function endpointFor(type: ScheduleTestType): string {
  return `/schedule-sets-${type}`;
}

// Read the right field for display. Returns a unified shape so the JSX
// can use item.setId / item.setName / item.setCount without conditionals.
function normalizeItem(item: ScheduleSetItem, type: ScheduleTestType) {
  if (type === 'api') {
    return {
      setId: item.scenario_set_id ?? 0,
      setName: item.scenario_set_name ?? '',
      setCount: item.scenario_count ?? 0,
    };
  }
  return {
    setId: item.case_set_id ?? 0,
    setName: item.case_set_name ?? '',
    setCount: item.case_count ?? 0,
  };
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

// Inline schedule config modal. The `item` shape comes pre-stamped with
// testType + normalized setId/setName/setCount by the parent (see
// fetchList in ScheduleList), so the modal can talk to the right endpoint
// and render the right labels without re-deriving anything.
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
  // 2026-06-06 (#79): see field→cron effect below.
  const skipFieldToCronSync = useRef(false);

  const MIN_OPTS = ['*', ...Array.from({ length: 60 }, (_, i) => String(i))];
  const HOUR_OPTS = ['*', ...Array.from({ length: 24 }, (_, i) => String(i))];
  const DAY_OPTS = ['*', ...Array.from({ length: 31 }, (_, i) => String(i + 1))];
  const MON_OPTS = ['*', ...Array.from({ length: 12 }, (_, i) => String(i + 1))];
  const DOW_OPTS = ['*', '0', '1', '2', '3', '4', '5', '6'];
  const DOW_LABELS: Record<string, string> = { '*': '每天', '0': '周日', '1': '周一', '2': '周二', '3': '周三', '4': '周四', '5': '周五', '6': '周六' };

  useEffect(() => {
    if (!item.cron_expr) return;
    setCronExpr(item.cron_expr);
    const parts = item.cron_expr.trim().split(/\s+/);
    if (parts.length < 5) return;
    // Mark sync as skip so the field→cron effect below doesn't overwrite the
    // canonical cronExpr we just set with a re-derived copy of the same parts.
    skipFieldToCronSync.current = true;
    setMinute(parts[0]);
    setHour(parts[1]);
    setDay(parts[2]);
    setMonth(parts[3]);
    setDow(parts[4]);
  }, [item.cron_expr]);

  // 2026-06-06 (#79): canonical direction is 5 fields → cronExpr. Any select
  // change flows through here. The skip flag breaks the loop when cronExpr
  // → 5 fields is the source (typing in the cron input or clicking a preset)
  // so we don't clobber the user's partial input by re-deriving it.
  useEffect(() => {
    if (skipFieldToCronSync.current) {
      skipFieldToCronSync.current = false;
      return;
    }
    setCronExpr(`${minute} ${hour} ${day} ${month} ${dow}`);
  }, [minute, hour, day, month, dow]);

  // 2026-06-06 (#79): when the user picks a preset, set both the cron string
  // and the 5 fields together. Mark the sync-skip so the effect above doesn't
  // re-derive (it would, but writing the same string back is wasted work and
  // can race with a subsequent keystroke).
  function applyPreset(v: string) {
    setCronExpr(v);
    const parts = v.trim().split(/\s+/);
    if (parts.length < 5) return;
    skipFieldToCronSync.current = true;
    setMinute(parts[0]);
    setHour(parts[1]);
    setDay(parts[2]);
    setMonth(parts[3]);
    setDow(parts[4]);
  }

  // 2026-06-06 (#79): typing in the cron input. The previous version called
  // `applyFromFields()` from the select onChange, which read stale state
  // (React batches setState calls — the new minute value wasn't visible
  // yet when buildCron ran). The new design lets the field→cron effect
  // own the direction instead.
  function handleExprChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setCronExpr(val);
    const parts = val.trim().split(/\s+/);
    if (parts.length < 5) return;
    skipFieldToCronSync.current = true;
    setMinute(parts[0]);
    setHour(parts[1]);
    setDay(parts[2]);
    setMonth(parts[3]);
    setDow(parts[4]);
  }

  async function doSave(enableImmediately: boolean) {
    if (status !== 'none' && !cronExpr) { setModalType('error'); setModalMsg('请选择执行时间'); setModalOpen(true); return; }
    // item is always stamped by the parent's fetchList; non-null asserted here
    // because the modal only opens via setConfigItem(item) from the list JSX.
    const ep = endpointFor(item.testType as ScheduleTestType);
    setSaving(true);
    try {
      const body = { cron_expr: cronExpr, status: enableImmediately ? 'active' : status };
      let res;
      if (item.id > 0) {
        res = await apiFetch(`${ep}/${item.id}/configure`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        // item.setId is the resolved id (scenario_set_id for api, case_set_id for the rest)
        res = await apiFetch(`${ep}/set/${item.setId}`, { method: 'PUT', body: JSON.stringify(body) });
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
            <div><span style={{ fontSize: 12, color: '#999' }}>{item.testType === 'api' ? '场景集' : '用例集'}</span><div style={{ fontSize: 14, marginTop: 2 }}>{item.setName}</div></div>
            <div><span style={{ fontSize: 12, color: '#999' }}>{item.testType === 'api' ? '场景数' : '用例数'}</span><div style={{ fontSize: 14, marginTop: 2 }}>{item.setCount}</div></div>
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
                  <select value={f.val} onChange={e => f.set(e.target.value)}
                    style={{ padding: '5px 8px', border: '1px solid #d9d9d9', borderRadius: 6, minWidth: f.label === '分' ? 80 : 70 }}>
                    {f.opts.map(o => <option key={o} value={o}>{o === '*' ? `每${f.label}` : (f.label === '周' ? DOW_LABELS[o] || o : o)}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fff', borderRadius: 6, border: '1px solid #e8e8e8' }}>
              <span style={{ fontSize: 12, color: '#999' }}>表达式</span>
              <input
                value={cronExpr}
                onChange={handleExprChange}
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, fontFamily: 'Courier New', color: '#1677ff', background: 'transparent' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <span style={{ fontSize: 14, color: '#333' }}>任务状态</span>
            <FormSelect
              value={status}
              options={[{value:'none',label:'未设置'},{value:'paused',label:'暂停'},{value:'active',label:'正常'}]}
              onChange={val => setStatus(val as typeof status)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="scenario-btn" onClick={onClose}>取消</button>
            <button className="scenario-btn" onClick={() => doSave(true)} disabled={saving}>
              {saving ? '保存中...' : '保存并启用'}
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

export default function ScheduleList({ basePath = '/api-test' }: { basePath?: string } = {}) {
  const navigate = useNavigate();
  const testType = resolveType(basePath);
  const ep = endpointFor(testType);
  // 2026-06-06 (#78): API endpoints use /scene-set/{id}; web/pc/mobile use /case-set/{id}
  const setPath = testType === 'api' ? 'scene-set' : 'case-set';
  const [list, setList] = useState<ScheduleSetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  // Modal expects the enriched row (testType + normalized setId/setName/setCount).
  // list items are stamped with those in fetchList so this assignment is safe.
  const [configItem, setConfigItem] = useState<ScheduleSetItem | null>(null);
  const [nameFilter, setNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [creatorFilter, setCreatorFilter] = useState('');

  const fetchList = async (pageNum = 1, pageSz = pageSize) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ScheduleSetItem[]; total: number; page: number; pageSize: number }>(`${ep}?page=${pageNum}&pageSize=${pageSz}`);
      if (res.code === 200 && res.data) {
        // Stamp each row with its testType so child components (modal/buttons)
        // can build the right endpoint without prop-drilling basePath.
        const items = (res.data.items || []).map(it => ({ ...it, testType, ...normalizeItem(it, testType) }));
        setList(items);
        setTotal(res.data.total || 0);
        setPage(res.data.page || 1);
        setPageSize(res.data.pageSize || 10);
      } else { setList([]); }
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchList(); }, []);

  const handlePause = async (item: ScheduleSetItem) => {
    if (item.id <= 0) return;
    await apiFetch(`${ep}/${item.id}/pause`, { method: 'POST' });
    fetchList(page);
  };

  const handleResume = async (item: ScheduleSetItem) => {
    if (item.id <= 0) return;
    await apiFetch(`${ep}/${item.id}/resume`, { method: 'POST' });
    fetchList(page);
  };

  const handleRemove = async (item: ScheduleSetItem) => {
    if (item.id <= 0) return;
    if (!confirm(`确认移除「${item.setName}」的定时配置？`)) return;
    await apiFetch(`${ep}/${item.id}/remove`, { method: 'POST' });
    fetchList(page);
  };

  const filtered = list.filter(item => {
    if (nameFilter && !(item.setName || '').includes(nameFilter)) return false;
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

  return (
    <div className="alist">
      {/* Filter bar */}
      <div className="alist-filter">
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>{testType === 'api' ? '场景集名称' : '用例集名称'}</label>
            <input placeholder="搜索名称" value={nameFilter} onChange={e => setNameFilter(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>创建人</label>
            <input placeholder="创建人" value={creatorFilter} onChange={e => setCreatorFilter(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>状态</label>
            <FormSelect value={statusFilter} options={[{value:"",label:"全部状态"},{value:"none",label:"未设置"},{value:"paused",label:"暂停"},{value:"active",label:"正常"}]} onChange={val => setStatusFilter(val)} />
          </div>
          <div className="alist-filter-actions">
            <button className="btn btn-default" onClick={handleReset}>重置</button>
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
                <th>{testType === 'api' ? '场景集名称' : '用例集名称'}</th>
                <th>{testType === 'api' ? '场景数' : '用例数'}</th>
                <th>创建人</th>
                <th>任务状态</th>
                <th>下次执行时间</th>
                <th>最近执行</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.setId}>
                  <td>{item.setName}</td>
                  <td>{item.setCount}</td>
                  <td>{item.creator_name}</td>
                  <td><span className={getBadgeClass(item.status)}>{STATUS_LABELS[item.status]}</span></td>
                  <td className="td-next-run">{item.status === 'active' && item.next_run_at ? formatDateTime(item.next_run_at) : '—'}</td>
                  <td className="td-next-run">{item.last_run_at ? formatDateTime(item.last_run_at) : '—'}</td>
                  <td>
                    <div className="row-actions" style={{ gap: 4, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => navigate(`${basePath}/${setPath}/${item.setId}`)}>进入</button>
                      <button className="btn btn-sm btn-default" onClick={() => setConfigItem(item)}>配置</button>
                      {item.status === 'active' && (
                        <button className="btn btn-sm" onClick={() => handlePause(item)}>暂停</button>
                      )}
                      {item.status === 'paused' && (
                        <button className="btn btn-sm" onClick={() => handleResume(item)}>启用</button>
                      )}
                      {item.id > 0 && (
                        <button className="btn btn-sm btn-danger" onClick={() => handleRemove(item)}>移除</button>
                      )}
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
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => fetchList(page - 1)}>上一页</button>
        <button className="btn btn-sm" disabled={page >= Math.ceil(total / pageSize) || total === 0} onClick={() => fetchList(page + 1)}>下一页</button>
        <FormSelect value={String(pageSize)} options={[{value:"10",label:"10条/页"},{value:"20",label:"20条/页"},{value:"50",label:"50条/页"},{value:"100",label:"100条/页"}]} onChange={val => { setPageSize(Number(val)); setPage(1); fetchList(1); }} />
      </div>

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