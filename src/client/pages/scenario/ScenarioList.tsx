import { useState, useEffect, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import type { Scenario } from '../../types';
import './ScenarioList.css';

const STATUSES = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

export default function ScenarioList() {
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fTags, setFTags] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');

  // Floating action buttons
  const [floatBtn, setFloatBtn] = useState<{ id: number; x: number; y: number } | null>(null);

  const fetchScenarios = async () => {
    try {
      const res = await apiFetch<Scenario[]>('/scenarios');
      if (res.code === 200 && res.data) setScenarios(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchScenarios(); }, []);

  // Close floating buttons on outside click
  useEffect(() => {
    const handler = () => setFloatBtn(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const handleCreate = () => {
    navigate('/scenario/new');
  };

  const handleRowClick = (e: MouseEvent, id: number) => {
    e.stopPropagation();
    setFloatBtn({ id, x: e.clientX, y: e.clientY });
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此场景？')) return;
    await apiFetch(`/scenarios/${id}`, { method: 'DELETE' });
    setFloatBtn(null);
    fetchScenarios();
  };

  const handleReset = () => {
    setFName('');
    setFDesc('');
    setFTags('');
    setFStatus('');
    setFDateFrom('');
    setFDateTo('');
  };

  const filtered = scenarios.filter((s) => {
    if (fStatus && s.status !== fStatus) return false;
    if (fName) {
      const search = fName.toLowerCase();
      if (!s.name.toLowerCase().includes(search)) return false;
    }
    if (fDesc && !(s.description || '').toLowerCase().includes(fDesc.toLowerCase())) return false;
    if (fTags && !(s.tags || '').toLowerCase().includes(fTags.toLowerCase())) return false;
    if (fDateFrom && s.created_at < fDateFrom) return false;
    if (fDateTo && s.created_at > fDateTo + 'T23:59:59') return false;
    return true;
  });

  const statusLabel = (s: string) => {
    if (s === 'active') return '启用';
    if (s === 'disabled') return '禁用';
    if (s === 'draft') return '草稿';
    return s;
  };

  return (
    <div className="alist">
      {/* Filter Area */}
      <div className="alist-filter">
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>场景名称</label>
            <input placeholder="搜索名称" value={fName} onChange={(e) => setFName(e.target.value)} />
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
          <div className="alist-filter-actions">
            <button className="alist-btn-query" onClick={handleReset}>重置</button>
            <button className="alist-btn-add" onClick={handleCreate}>新增</button>
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
                <th>场景名称</th>
                <th>描述</th>
                <th>标签</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} onClick={(e) => handleRowClick(e, s.id)} className={floatBtn?.id === s.id ? 'active-row' : ''}>
                  <td>{s.name}</td>
                  <td className="td-desc">{s.description || '-'}</td>
                  <td>
                    {s.tags ? s.tags.split(',').filter(Boolean).map((t) => (
                      <span key={t} className="tag-badge">{t.trim()}</span>
                    )) : '-'}
                  </td>
                  <td><span className={`status-text status-${s.status}`}>{statusLabel(s.status)}</span></td>
                  <td>{s.created_at.replace('T', ' ').slice(0, 16)}</td>
                  <td>{s.updated_at.replace('T', ' ').slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Floating Action Buttons */}
      {floatBtn && (
        <div
          className="alist-float"
          style={{ left: floatBtn.x, top: floatBtn.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="alist-float-btn alist-float-view" onClick={() => { setFloatBtn(null); navigate(`/scenario/${floatBtn.id}`); }}>
            查看
          </button>
          <button className="alist-float-btn alist-float-exec" onClick={() => { setFloatBtn(null); navigate(`/scenario/${floatBtn.id}?exec=1`); }}>
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
