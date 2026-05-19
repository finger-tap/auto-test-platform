import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import MessageModal from '../../components/MessageModal';
import type { Scenario } from '../../types';
import './ScheduleDetail.css';

interface ScheduleScenario {
  id: number;
  name: string;
  description: string | null;
  status: string;
  user_id: number;
}

interface ScheduleData {
  id: number;
  scenario_id: number;
  cron_expr: string | null;
  status: 'none' | 'paused' | 'active';
  next_run_at: string | null;
}

// Cron presets with labels
const CRON_PRESETS = [
  { label: '每天 7:30',    value: '30 7 * * *' },
  { label: '每天 9:00',    value: '0 9 * * *' },
  { label: '工作日 9:00',  value: '0 9 * * 1-5' },
  { label: '每周一 9:00',  value: '0 9 * * 1' },
  { label: '每月 1 日 9:00', value: '0 9 1 * *' },
  { label: '每小时',       value: '0 * * * *' },
];

const MIN_OPTIONS  = ['*', '0', '15', '30', '45'];
const HOUR_OPTIONS = ['*', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23'];
const DAY_OPTIONS  = ['*', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31'];
const MON_OPTIONS  = ['*', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const DOW_OPTIONS  = ['*', '1', '2', '3', '4', '5', '6', '0'];

const DOW_LABELS: Record<string, string> = { '*': '每天', '1': '周一', '2': '周二', '3': '周三', '4': '周四', '5': '周五', '6': '周六', '0': '周日' };

export default function ScheduleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const scenarioId = Number(id);

  const [scenario, setScenario] = useState<ScheduleScenario | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);

  // Cron state
  const [cronExpr, setCronExpr] = useState('0 9 * * *');
  const [minute, setMinute] = useState('0');
  const [hour, setHour] = useState('9');
  const [day, setDay] = useState('*');
  const [month, setMonth] = useState('*');
  const [dow, setDow] = useState('*');

  // Status
  const [status, setStatus] = useState<'none' | 'paused' | 'active'>('none');

  // Save states
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMsg, setModalMsg] = useState('');
  const [modalType, setModalType] = useState<'success' | 'error' | 'warning'>('success');

  // Load scenario + existing schedule
  useEffect(() => {
    if (!scenarioId) return;

    Promise.all([
      apiFetch<{ scenario: Scenario }>(`/scenarios/${scenarioId}`),
      apiFetch<ScheduleData[]>(`/schedules?pageSize=1000`),
    ]).then(([scRes, scdRes]) => {
      if (scRes.code === 200 && scRes.data?.scenario) {
        setScenario(scRes.data.scenario);
      }
      if (scdRes.code === 200 && scdRes.data) {
        const found = scdRes.data.find((s: ScheduleData) => s.scenario_id === scenarioId);
        if (found) {
          setSchedule(found);
          setStatus(found.status);
          setCronExpr(found.cron_expr || '0 9 * * *');
          parseCron(found.cron_expr || '0 9 * * *');
        }
      }
      setLoading(false);
    });
  }, [scenarioId]);

  function parseCron(expr: string) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length >= 5) {
      setMinute(parts[0]);
      setHour(parts[1]);
      setDay(parts[2]);
      setMonth(parts[3]);
      setDow(parts[4]);
    }
  }

  function buildCron() {
    return `${minute} ${hour} ${day} ${month} ${dow}`;
  }

  function applyPreset(value: string) {
    setCronExpr(value);
    parseCron(value);
  }

  function applyFromFields() {
    const expr = buildCron();
    setCronExpr(expr);
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = { cron_expr: cronExpr, status };
      let res;

      if (schedule && schedule.id > 0) {
        res = await apiFetch<{ code: number; message: string }>(`/schedules/${schedule.id}/configure`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        res = await apiFetch<{ code: number; message: string }>(`/schedules/scenario/${scenarioId}`, { method: 'PUT', body: JSON.stringify(body) });
      }

      if (res.code === 200) {
        setModalType('success');
        setModalMsg('保存成功');
        setModalOpen(true);
        setTimeout(() => navigate('/api-test/schedule'), 1200);
      } else {
        setModalType('error');
        setModalMsg(res.message || '保存失败');
        setModalOpen(true);
      }
    } catch (err) {
      setModalType('error');
      setModalMsg(err instanceof Error ? err.message : '保存失败');
      setModalOpen(true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page-card" style={{ padding: 16 }}><div style={{ textAlign: 'center', padding: 40 }}>加载中…</div></div>;

  return (
    <div className="page-card" style={{ padding: 16, maxWidth: 720 }}>
      {/* Back */}
      <div style={{ marginBottom: 16 }}>
        <button className="btn-back" onClick={() => navigate('/api-test/schedule')}>← 返回列表</button>
      </div>

      {/* 场景信息 */}
      <div className="sd-section">
        <h3 className="sd-title">场景信息</h3>
        <div className="sd-info-grid">
          <div className="sd-info-item">
            <span className="sd-label">场景名称</span>
            <span className="sd-value">{scenario?.name || '—'}</span>
          </div>
          <div className="sd-info-item">
            <span className="sd-label">场景描述</span>
            <span className="sd-value">{scenario?.description || '—'}</span>
          </div>
        </div>
      </div>

      {/* 定时配置 */}
      <div className="sd-section">
        <h3 className="sd-title">定时配置</h3>

        {/* Presets */}
        <div className="sd-presets">
          {CRON_PRESETS.map(p => (
            <button
              key={p.value}
              className={`sd-preset-btn ${cronExpr === p.value ? 'sd-preset-active' : ''}`}
              onClick={() => applyPreset(p.value)}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Visual cron builder */}
        <div className="sd-cron-builder">
          <div className="sd-cron-row">
            <div className="sd-cron-field">
              <label>分</label>
              <select value={minute} onChange={e => { setMinute(e.target.value); applyFromFields(); }}>
                {MIN_OPTIONS.map(v => <option key={v} value={v}>{v === '*' ? '每分' : v}</option>)}
              </select>
            </div>
            <div className="sd-cron-field">
              <label>时</label>
              <select value={hour} onChange={e => { setHour(e.target.value); applyFromFields(); }}>
                {HOUR_OPTIONS.map(v => <option key={v} value={v}>{v === '*' ? '每小时' : `${v}时`}</option>)}
              </select>
            </div>
            <div className="sd-cron-field">
              <label>日</label>
              <select value={day} onChange={e => { setDay(e.target.value); applyFromFields(); }}>
                {DAY_OPTIONS.map(v => <option key={v} value={v}>{v === '*' ? '每天' : v}</option>)}
              </select>
            </div>
            <div className="sd-cron-field">
              <label>月</label>
              <select value={month} onChange={e => { setMonth(e.target.value); applyFromFields(); }}>
                {MON_OPTIONS.map(v => <option key={v} value={v}>{v === '*' ? '每月' : `${v}月`}</option>)}
              </select>
            </div>
            <div className="sd-cron-field">
              <label>周</label>
              <select value={dow} onChange={e => { setDow(e.target.value); applyFromFields(); }}>
                {DOW_OPTIONS.map(v => <option key={v} value={v}>{DOW_LABELS[v]}</option>)}
              </select>
            </div>
          </div>

          {/* Raw expression preview */}
          <div className="sd-cron-preview">
            <span className="sd-cron-preview-label">表达式</span>
            <code className="sd-cron-preview-expr">{cronExpr}</code>
            <span className="sd-cron-preview-hint">
              {dow !== '*' ? `（${DOW_LABELS[dow] || ''}）` : ''}
              {day !== '*' ? `（每月${day}日）` : ''}
              {month !== '*' ? `（${month}月）` : ''}
            </span>
          </div>
        </div>

        {/* Status */}
        <div className="sd-status-row">
          <span className="sd-label">任务状态</span>
          <select
            className="sd-status-select"
            value={status}
            onChange={e => setStatus(e.target.value as 'none' | 'paused' | 'active')}>
            <option value="none">未设置</option>
            <option value="paused">暂停</option>
            <option value="active">正常</option>
          </select>
        </div>
      </div>

      {/* Actions */}
      <div className="sd-actions">
        <button className="btn-cancel" onClick={() => navigate('/api-test/schedule')}>取消</button>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存配置'}
        </button>
      </div>

      <MessageModal open={modalOpen} message={modalMsg} type={modalType} onClose={() => setModalOpen(false)} />
    </div>
  );
}