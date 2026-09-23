import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, is2xx } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import FormSelect from '../../components/FormSelect';
import PageSizeSelect from '../../components/PageSizeSelect';
import DevicePickerModal, { type PickerDevice } from '../../components/DevicePickerModal';
import './ScheduleList.css';
import { useViewportPageSize } from '../../hooks/useViewportPageSize';

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
  device_id?: number | null;
  device_name?: string | null;
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
  // 远程设备选择（web/pc 类型）
  const [selectedDevice, setSelectedDevice] = useState<PickerDevice | null>(
    item.device_id ? { id: item.device_id, name: item.device_name || `设备#${item.device_id}`, platform: '', status: 'online', busy: false, source: 'remote' } : null
  );
  const [showDevicePicker, setShowDevicePicker] = useState(false);
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
      const body: Record<string, unknown> = { cron_expr: cronExpr, status: enableImmediately ? 'active' : status };
      // 传递设备 ID（web/pc 类型）
      if (item.testType === 'web' || item.testType === 'pc') {
        body.device_id = selectedDevice && typeof selectedDevice.id === 'number' ? selectedDevice.id : null;
      }
      let res;
      if (item.id > 0) {
        res = await apiFetch(`${ep}/${item.id}/configure`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        // item.setId is the resolved id (scenario_set_id for api, case_set_id for the rest)
        res = await apiFetch(`${ep}/set/${item.setId}`, { method: 'PUT', body: JSON.stringify(body) });
      }
      const data = await res;
      setSaving(false);
      if (is2xx(data.code)) {
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
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
        <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 28, width: 640, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: 'var(--fg)' }}>配置定时任务</h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--fg-tertiary)' }}>✕</button>
          </div>

          <div style={{ background: 'var(--surface-raised)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><span style={{ fontSize: 12, color: 'var(--fg-tertiary)' }}>{item.testType === 'api' ? '场景集' : '用例集'}</span><div style={{ fontSize: 14, marginTop: 2 }}>{item.setName}</div></div>
            <div><span style={{ fontSize: 12, color: 'var(--fg-tertiary)' }}>{item.testType === 'api' ? '场景数' : '用例数'}</span><div style={{ fontSize: 14, marginTop: 2 }}>{item.setCount}</div></div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--fg-secondary)', marginBottom: 8, fontWeight: 500 }}>常用时间</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {CRON_PRESETS.map(p => (
                <button key={p.value} onClick={() => applyPreset(p.value)}
                  style={{ padding: '4px 12px', borderRadius: 16, border: `1px solid ${cronExpr === p.value ? 'var(--accent)' : 'var(--border)'}`, background: cronExpr === p.value ? 'var(--accent)' : 'var(--surface)', color: cronExpr === p.value ? '#fff' : 'var(--fg)', cursor: 'pointer', fontSize: 13 }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--surface-raised)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--fg-secondary)', marginBottom: 10, fontWeight: 500 }}>自定义时间</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
              {[
                { label: '分', opts: MIN_OPTS, val: minute, set: setMinute },
                { label: '时', opts: HOUR_OPTS, val: hour, set: setHour },
                { label: '日', opts: DAY_OPTS, val: day, set: setDay },
                { label: '月', opts: MON_OPTS, val: month, set: setMonth },
                { label: '周', opts: DOW_OPTS, val: dow, set: setDow },
              ].map(f => (
                <div key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--fg-secondary)' }}>{f.label}</span>
                  <FormSelect
                    value={f.val}
                    options={f.opts.map(o => ({
                      value: o,
                      label: o === '*' ? `每${f.label}` : (f.label === '周' ? DOW_LABELS[o] || o : o),
                    }))}
                    onChange={f.set}
                    size="compact"
                    style={{ minWidth: f.label === '分' ? 90 : 76 }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface)', borderRadius: 6, border: '1px solid #e8e8e8' }}>
              <span style={{ fontSize: 12, color: 'var(--fg-tertiary)' }}>表达式</span>
              <input
                value={cronExpr}
                onChange={handleExprChange}
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, fontFamily: 'Courier New', color: 'var(--accent)', background: 'transparent' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <span style={{ fontSize: 14, color: 'var(--fg)' }}>任务状态</span>
            <FormSelect
              value={status}
              options={[{value:'none',label:'未设置'},{value:'paused',label:'暂停'},{value:'active',label:'正常'}]}
              onChange={val => setStatus(val as typeof status)}
            />
          </div>

          {/* 远程设备选择（仅 web/pc 类型） */}
          {(item.testType === 'web' || item.testType === 'pc') && (
            <div style={{ background: 'var(--surface-raised)', borderRadius: 8, padding: 16, marginBottom: 24 }}>
              <div style={{ fontSize: 13, color: 'var(--fg-secondary)', marginBottom: 10, fontWeight: 500 }}>执行设备</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  className="scenario-btn scenario-btn--outline"
                  onClick={() => setShowDevicePicker(true)}
                  style={{ fontSize: 13 }}
                >
                  {selectedDevice ? `更换设备` : '选择设备'}
                </button>
                {selectedDevice ? (
                  <span style={{ fontSize: 13, color: 'var(--fg)' }}>
                    🖥 {selectedDevice.name}
                    <button
                      onClick={() => setSelectedDevice(null)}
                      style={{ background: 'none', border: 'none', color: 'var(--fg-tertiary)', cursor: 'pointer', marginLeft: 8, fontSize: 12 }}
                    >
                      ✕ 清除
                    </button>
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--fg-tertiary)' }}>不指定则使用本机执行</span>
                )}
              </div>
            </div>
          )}

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
          background: modalType === 'success' ? 'var(--success-subtle)' : 'var(--danger-subtle)',
          color: modalType === 'success' ? 'var(--success)' : 'var(--danger)',
          border: `1px solid ${modalType === 'success' ? 'var(--success)' : 'var(--danger)'}`,
        }}>
          {modalMsg}
        </div>
      )}

      {/* Device Picker Modal (web/pc only) */}
      {(item.testType === 'web' || item.testType === 'pc') && (
        <DevicePickerModal
          open={showDevicePicker}
          testType={item.testType as 'web' | 'pc'}
          onClose={() => setShowDevicePicker(false)}
          onSelect={(device) => { setSelectedDevice(device); setShowDevicePicker(false); }}
          onLocalExecute={() => { setSelectedDevice(null); setShowDevicePicker(false); }}
        />
      )}
    </>
  );
}

export default function ScheduleList({ basePath = '/api-test' }: { basePath?: string } = {}) {
  const navigate = useNavigate();
  const testType = resolveType(basePath);
  const ep = endpointFor(testType);
  // 统一为 /{testType}/case-set
  const setPath = 'case-set';
  const [list, setList] = useState<ScheduleSetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  // 每页行数自适应视口: 按表格容器真实高度算, 保证表格恰好填满一屏不滚动;
  // 用户在分页条手动选择条数后以手动值为准。
  const [autoPageSize, tableWrapRef] = useViewportPageSize();
  const [userPageSize, setUserPageSize] = useState<number | null>(null);
  const pageSize = userPageSize ?? autoPageSize;
  const setPageSize = setUserPageSize;
  const [total, setTotal] = useState(0);
  // Modal expects the enriched row (testType + normalized setId/setName/setCount).
  // list items are stamped with those in fetchList so this assignment is safe.
  const [configItem, setConfigItem] = useState<ScheduleSetItem | null>(null);
  const [nameFilter, setNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [creatorFilter, setCreatorFilter] = useState('');
  const [appliedName, setAppliedName] = useState('');
  const [appliedStatus, setAppliedStatus] = useState('');
  const [appliedCreator, setAppliedCreator] = useState('');

  const fetchSeq = useRef(0);
  const fetchList = async (
    pageNum = 1,
    pageSz = pageSize,
    // 默认带上已应用的筛选: 翻页/每页条数变化不再丢失筛选条件 (2026-08-31)
    flt: { name?: string; status?: string; creator?: string } = { name: appliedName, status: appliedStatus, creator: appliedCreator },
  ) => {
    // 竞态守卫: 仅最新一次请求的响应可以落地(StrictMode/行数校准都会并发重拉)
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      // 2026-08-25: 筛选走服务端(此前本地只过滤当前页, 其他页的数据永远搜不到)
      const qs = new URLSearchParams({ page: String(pageNum), pageSize: String(pageSz) });
      if (flt.name) qs.set('name', flt.name);
      if (flt.status) qs.set('status', flt.status);
      if (flt.creator) qs.set('creator', flt.creator);
      const res = await apiFetch<{ items: ScheduleSetItem[]; total: number; page: number; pageSize: number }>(`${ep}?${qs.toString()}`);
      if (seq !== fetchSeq.current) return;
      if (is2xx(res.code) && res.data) {
        // Stamp each row with its testType so child components (modal/buttons)
        // can build the right endpoint without prop-drilling basePath.
        const items = (res.data.items || []).map(it => ({ ...it, testType, ...normalizeItem(it, testType) }));
        setList(items);
        setTotal(res.data.total || 0);
        setPage(res.data.page || 1);
      } else { setList([]); }
    } finally { if (seq === fetchSeq.current) setLoading(false); }
  };

  useEffect(() => { fetchList(); }, []);

  // 每页条数变化(视口自适应/手动选择)时刷新; 首次由上面的 effect 拉取, 跳过
  const sizeFirstRun = useRef(true);
  useEffect(() => {
    if (sizeFirstRun.current) { sizeFirstRun.current = false; return; }
    fetchList(page, pageSize);
  }, [pageSize]);

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
    const ok = await notification.confirm(`确认移除「${item.setName}」的定时配置？`);
    if (!ok) return;
    await apiFetch(`${ep}/${item.id}/remove`, { method: 'POST' });
    fetchList(page);
  };

  // 筛选已由服务端执行, 直接渲染接口结果
  const filtered = list;

  const handleQuery = () => {
    setAppliedName(nameFilter);
    setAppliedStatus(statusFilter);
    setAppliedCreator(creatorFilter);
    setPage(1);
    fetchList(1, pageSize, { name: nameFilter, status: statusFilter, creator: creatorFilter });
  };

  const getBadgeClass = (status: string) => {
    if (status === 'active') return 'st-badge st-active';
    if (status === 'paused') return 'st-badge st-paused';
    return 'st-badge st-none';
  };

  const handleReset = () => {
    setNameFilter('');
    setStatusFilter('');
    setCreatorFilter('');
    setAppliedName('');
    setAppliedStatus('');
    setAppliedCreator('');
    fetchList(1, pageSize, {});
  };

  return (
    <div className="alist page-enter">
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
            <button className="btn btn-primary" onClick={handleQuery}>查询</button>
            <button className="btn btn-default" onClick={handleReset}>重置</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="alist-table-wrap" ref={tableWrapRef}>
        {loading ? (
          <div className="alist-empty">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="alist-empty">
            <p>暂无定时任务</p>
            <p className="alist-empty-hint">在左侧「用例集」或「场景集」的详情页可为集合配置 cron 定时执行</p>
          </div>
        ) : (
          <table className="alist-table">
            <thead>
              <tr>
                <th>{testType === 'api' ? '场景集名称' : '用例集名称'}</th>
                <th style={{ width: 84 }}>{testType === 'api' ? '场景数' : '用例数'}</th>
                <th style={{ width: 124 }}>创建人</th>
                <th style={{ width: 92 }}>任务状态</th>
                <th style={{ width: 162 }}>下次执行时间</th>
                <th style={{ width: 162 }}>最近执行</th>
                <th style={{ width: 204 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, index) => (
                <tr key={item.setId} className="row-enter" style={{ '--delay': `${index * 30}ms` } as React.CSSProperties}>
                  <td className="td-name" title={item.setName}>{item.setName}</td>
                  <td>{item.setCount}</td>
                  <td className="td-ellipsis" title={item.creator_name}>{item.creator_name}</td>
                  <td><span className={getBadgeClass(item.status)}>{STATUS_LABELS[item.status]}</span></td>
                  <td className="td-next-run">{item.status === 'active' && item.next_run_at ? formatDateTime(item.next_run_at) : '—'}</td>
                  <td className="td-next-run">{item.last_run_at ? formatDateTime(item.last_run_at) : '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" onClick={() => navigate(`${basePath}/${setPath}/${item.setId}`)}>进入</button>
                      <button className="row-action-btn" onClick={() => setConfigItem(item)}>配置</button>
                      <button className="row-action-btn" disabled={item.status !== 'active'} onClick={() => handlePause(item)}>暂停</button>
                      <button className="row-action-btn" disabled={item.status !== 'paused'} onClick={() => handleResume(item)}>启用</button>
                      <button className="row-action-btn row-action-del" disabled={item.id <= 0} onClick={() => handleRemove(item)}>移除</button>
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
        <PageSizeSelect autoSize={autoPageSize} value={pageSize} onChange={n => { setPageSize(n); setPage(1); }} />
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