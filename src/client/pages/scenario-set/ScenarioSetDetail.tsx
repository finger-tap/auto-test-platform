import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import { InlineText, InlineSelect } from '../../components/InlineEdit';
import type { Scenario } from '../../types';
import './ScenarioSetDetail.css';

interface SetDetail {
  id: number;
  name: string;
  description: string | null;
  tags: string;
  status: string;
  scenario_ids: number[];
  scenarios: Scenario[];
  created_at: string;
  updated_at: string;
}

interface BatchReport {
  set_id: number;
  set_name: string;
  total: number;
  passed: number;
  failed: number;
  total_duration_ms: number;
  scenarios: Array<{
    scenario_id: number;
    scenario_name: string;
    status: string;
    duration_ms: number | null;
    error_message?: string | null;
    node_summary?: { passed: number; failed: number; total: number };
  }>;
  executed_at: string;
  executed_by: string;
}

interface SavedReport extends BatchReport { id: number; }

const STATUS_OPTIONS = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

const TABS = [
  { key: 'detail', label: '场景集详情' },
  { key: 'scenarios', label: '场景列表' },
  { key: 'reports', label: '执行记录' },
];

export default function ScenarioSetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const [setData, setSetData] = useState<SetDetail | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState('draft');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [allScenarios, setAllScenarios] = useState<Scenario[]>([]);
  const [scenarioKeyword, setScenarioKeyword] = useState('');
  const [addModalKeyword, setAddModalKeyword] = useState('');
  const [addModalDesc, setAddModalDesc] = useState('');
  const [addModalTags, setAddModalTags] = useState('');
  const [addModalStatus, setAddModalStatus] = useState('');
  const [addModalPage, setAddModalPage] = useState(1);
  const [addModalPageSize, setAddModalPageSize] = useState(10);
  const [addModalTotal, setAddModalTotal] = useState(0);
  const [addModalChecked, setAddModalChecked] = useState<Set<number>>(new Set());
  const [addModalLoading, setAddModalLoading] = useState(false);
  const [showAddScenarioModal, setShowAddScenarioModal] = useState(false);
  const [addModalScenarios, setAddModalScenarios] = useState<Scenario[]>([]);
  const [executing, setExecuting] = useState(false);
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [expandedReport, setExpandedReport] = useState<number | null>(null);
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<number>>(new Set());
  const [modalWidth, setModalWidth] = useState('80%');
  const { activeEnv } = useEnvironment();
  const originalRef = useRef({ name: '', description: '', tags: '', status: 'draft', selectedIds: [] as number[] });
  const dirtyRef = useRef(false);
  const [activeTab, setActiveTab] = useState('detail');

  useEffect(() => {
    const updateModalWidth = () => {
      const mainEl = document.querySelector('.layout-main');
      if (mainEl) { const w = (mainEl as HTMLElement).offsetWidth; setModalWidth(`${w * 0.8}px`); }
    };
    updateModalWidth();
    window.addEventListener('resize', updateModalWidth);
    return () => window.removeEventListener('resize', updateModalWidth);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape' && showAddScenarioModal) setShowAddScenarioModal(false); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showAddScenarioModal]);

  useEffect(() => {
    if (isNew) dirtyRef.current = !!(name || description || tags || selectedIds.length > 0);
    else dirtyRef.current =
      name !== originalRef.current.name || description !== originalRef.current.description ||
      tags !== originalRef.current.tags || status !== originalRef.current.status ||
      JSON.stringify([...selectedIds].sort()) !== JSON.stringify([...originalRef.current.selectedIds].sort());
  }, [name, description, tags, status, selectedIds]);

  useEffect(() => {
    if (!isNew && id) {
      apiFetch<SetDetail>(`/scenario-sets/${id}`).then(res => {
        if (res.code === 200 && res.data) {
          setSetData(res.data); setName(res.data.name); setDescription(res.data.description || '');
          setTags(res.data.tags || ''); setStatus(res.data.status || 'draft'); setSelectedIds(res.data.scenario_ids);
          originalRef.current = { name: res.data.name, description: res.data.description || '', tags: res.data.tags || '', status: res.data.status || 'draft', selectedIds: [...res.data.scenario_ids] };
          dirtyRef.current = false;
        }
      }).finally(() => setLoading(false));
      apiFetch<SavedReport[]>(`/scenario-sets/${id}/reports`).then(res => { if (res.code === 200) setReports(res.data || []); });
    }
  }, [id]);

  useEffect(() => {
    apiFetch<{ items: Scenario[] }>('/scenarios?page=1&pageSize=1000').then(res => { if (res.code === 200) setAllScenarios(res.data?.items || []); });
  }, []);

  function handleFieldChange(setter: React.Dispatch<React.SetStateAction<string>>, value: string) { setter(value); dirtyRef.current = true; }
  function handleStatusChange(value: string) { setStatus(value); dirtyRef.current = true; }

  async function doSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isNew) {
        const res = await apiFetch<{ id: number }>('/scenario-sets', { method: 'POST', body: JSON.stringify({ name: name.trim(), description, tags, status, scenario_ids: selectedIds }) });
        if (res.code === 201 && res.data) setTimeout(() => navigate(`/api-test/scene-set/${res.data!.id}`), 300);
      } else {
        await apiFetch(`/scenario-sets/${id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim(), description, tags, status, scenario_ids: selectedIds }) });
        dirtyRef.current = false;
      }
    } finally { setSaving(false); }
  }

  async function doExecute() {
    if (!id || isNew || selectedIds.length === 0) return;
    setExecuting(true);
    try {
      const res = await apiFetch<BatchReport>(`/scenario-sets/${id}/execute`, { method: 'POST', body: JSON.stringify({ environmentId: activeEnv?.id }) });
      if (res.code === 200) apiFetch<SavedReport[]>(`/scenario-sets/${id}/reports`).then(r => { if (r.code === 200) setReports(r.data || []); });
    } finally { setExecuting(false); }
  }

  function toggleScenario(id: number) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    setSelectedForRemoval(prev => { const next = new Set(prev); next.delete(id); return next; });
  }

  function addScenarios(ids: number[]) { setSelectedIds(prev => [...new Set([...prev, ...ids])]); setShowAddScenarioModal(false); }

  const fetchAddableScenarios = async (pageNum = 1, pageSz = addModalPageSize) => {
    try {
      setAddModalLoading(true);
      const res = await apiFetch<{ items: Scenario[]; total: number }>(`/scenarios?page=${pageNum}&pageSize=${pageSz}`);
      if (res.code === 200 && res.data) {
        let items = res.data.items.filter(s => !selectedIds.includes(s.id));
        if (addModalKeyword) { const kw = addModalKeyword.toLowerCase(); items = items.filter(s => s.name.toLowerCase().includes(kw)); }
        if (addModalDesc) { const kw = addModalDesc.toLowerCase(); items = items.filter(s => (s.description || '').toLowerCase().includes(kw)); }
        if (addModalTags) { const kw = addModalTags.toLowerCase(); items = items.filter(s => (s.tags || '').toLowerCase().includes(kw)); }
        if (addModalStatus) items = items.filter(s => s.status === addModalStatus);
        setAddModalTotal(res.data.total); setAddModalScenarios(items); setAddModalPage(pageNum); setAddModalPageSize(pageSz);
      }
    } finally { setAddModalLoading(false); }
  };

  function openAddModal() {
    setAddModalKeyword(''); setAddModalDesc(''); setAddModalTags(''); setAddModalStatus('');
    setAddModalPage(1); setAddModalChecked(new Set());
    fetchAddableScenarios(1, 10);
    setShowAddScenarioModal(true);
  }

  function addCheckedScenarios() { if (addModalChecked.size === 0) return; addScenarios(Array.from(addModalChecked)); }

  function toggleCheck(id: number) { setSelectedForRemoval(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function removeChecked() { if (selectedForRemoval.size === 0) return; setSelectedIds(prev => prev.filter(id => !selectedForRemoval.has(id))); setSelectedForRemoval(new Set()); }

  if (loading) return <div className="sset-detail-loading">加载中...</div>;

  const selectedScenarios = allScenarios.filter(s => selectedIds.includes(s.id));
  const filteredSelected = selectedScenarios.filter(s => s.name.toLowerCase().includes(scenarioKeyword.toLowerCase()));
  const tagList = tags ? tags.split(',').filter(Boolean).map(t => t.trim()) : [];

  // ─── Tab: Detail ───
  const renderDetailTab = () => (
    <div className="tab-content-wrapper">
      <div className="sset-info-section">
        <div className="sset-info-row">
          <div className="sset-info-field"><label>集名称</label><InlineText value={name} onChange={v => handleFieldChange(setName, v)} placeholder="点击输入集名称" /></div>
          <div className="sset-info-field sset-info-field-inline"><label>状态</label><InlineSelect value={status} options={STATUS_OPTIONS} onChange={handleStatusChange} renderDisplay={(v, label) => <span className={`sset-status-badge status-${v}`}>{label}</span>} /></div>
        </div>
        <div className="sset-info-row">
          <div className="sset-info-field">
            <label>标签</label>
            <div className="sset-inline-tags">
              <InlineText value={tags || ''} onChange={v => handleFieldChange(setTags, v)} placeholder="逗号分隔，如：回归,核心" />
              {tagList.length > 0 && (<div className="sset-tags">{tagList.map((tag, i) => (<span key={i} className="sset-tag">{tag}</span>))}</div>)}
            </div>
          </div>
        </div>
        <div className="sset-info-row">
          <div className="sset-info-field"><label>描述</label><InlineText value={description || ''} onChange={v => handleFieldChange(setDescription, v)} placeholder="点击输入描述" multiline /></div>
        </div>
        {!isNew && (
          <div className="sset-info-row">
            <div className="sset-info-field"><label>创建时间</label><span className="sset-field-value">{setData?.created_at?.replace('T', ' ').slice(0, 19) || '-'}</span></div>
            <div className="sset-info-field"><label>更新时间</label><span className="sset-field-value">{setData?.updated_at?.replace('T', ' ').slice(0, 19) || '-'}</span></div>
          </div>
        )}
      </div>
    </div>
  );

  // ─── Tab: Scenarios ───
  const renderScenariosTab = () => (
    <div className="tab-content-wrapper">
      <div className="sset-card-header" style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 12, marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>场景列表（{selectedScenarios.length} 个）</h3>
        <div className="sset-scenario-actions">
          <input className="sset-scenario-search" placeholder="搜索场景名称" value={scenarioKeyword} onChange={e => setScenarioKeyword(e.target.value)} />
          <button className="sset-btn-add" onClick={openAddModal}>+ 添加场景</button>
          {selectedForRemoval.size > 0 && (<button className="sset-btn-remove-checked" onClick={removeChecked}>移除选中（{selectedForRemoval.size}）</button>)}
        </div>
      </div>
      {selectedScenarios.length === 0 ? (<div className="sset-empty">暂无场景，点击上方"添加场景"进行选择</div>) : (
        <table className="sset-table">
          <thead><tr><th style={{ width: 40 }}><input type="checkbox" checked={filteredSelected.length > 0 && filteredSelected.every(s => selectedForRemoval.has(s.id))} onChange={e => { if (e.target.checked) setSelectedForRemoval(new Set(filteredSelected.map(s => s.id))); else setSelectedForRemoval(new Set()); }} /></th><th>场景名称</th><th>状态</th><th style={{ width: 160 }}>操作</th></tr></thead>
          <tbody>
            {filteredSelected.map(s => (
              <tr key={s.id}>
                <td><input type="checkbox" checked={selectedForRemoval.has(s.id)} onChange={() => toggleCheck(s.id)} /></td>
                <td>{s.name}</td>
                <td><span className={`sset-status-badge status-${s.status}`}>{s.status === 'active' ? '启用' : s.status === 'disabled' ? '禁用' : '草稿'}</span></td>
                <td>
                  <button className="sset-btn-text" onClick={() => navigate(`/api-test/scene-case/${s.id}`)}>查看详情</button>
                  <button className="sset-btn-text sset-btn-text-danger" onClick={() => toggleScenario(s.id)}>移除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  // ─── Tab: Reports ───
  const renderReportsTab = () => (
    <div className="tab-content-wrapper">
      {reports.length === 0 ? (<div className="sset-empty">暂无执行记录</div>) : (
        <div className="sset-reports">
          {reports.map((r, idx) => {
            const total = r.passed + r.failed;
            const rate = total > 0 ? Math.round((r.passed / total) * 100) : 0;
            return (
              <div key={r.id || idx} className="sset-report-row">
                <div className="sset-report-summary" onClick={() => setExpandedReport(expandedReport === r.id ? null : r.id)}>
                  <div className="sset-report-time">{r.executed_at.replace('T', ' ').slice(0, 19)}</div>
                  <div className="sset-report-stats">
                    <span className="sset-report-pass">{r.passed} 通过</span>
                    <span className="sset-report-fail">{r.failed} 失败</span>
                    <span className="sset-report-rate">{rate}%</span>
                    <span className="sset-report-toggle">{expandedReport === r.id ? '收起' : '展开'}</span>
                  </div>
                </div>
                {expandedReport === r.id && (
                  <div className="sset-report-detail">
                    {r.scenarios.map((sc, i) => (
                      <div key={i} className={`sset-report-scenario sset-report-${sc.status}`}>
                        <span className="sset-report-icon">{sc.status === 'success' ? '✓' : sc.status === 'skipped' ? '—' : '✗'}</span>
                        <span>{sc.scenario_name}</span>
                        {sc.duration_ms != null && <span className="sset-report-dur">{sc.duration_ms}ms</span>}
                        {sc.node_summary && <span className="sset-report-node">{sc.node_summary.passed}/{sc.node_summary.total}</span>}
                        {sc.error_message && <span className="sset-report-error">{sc.error_message}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="sset-detail">
      <div className="sset-detail-header">
        <button className="sset-back" onClick={() => navigate('/api-test/scene-set')}>← 返回列表</button>
        <span className="sset-detail-page-title">场景集详情</span>
      </div>
      <div className="sset-detail-content">
        <div className="sset-card" style={{ padding: 0 }}>
          <div className="tab-nav">{TABS.map((tab) => (<button key={tab.key} className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>))}</div>
          <div className="tab-body">
            {activeTab === 'detail' && renderDetailTab()}
            {activeTab === 'scenarios' && renderScenariosTab()}
            {activeTab === 'reports' && renderReportsTab()}
          </div>
          {activeTab !== 'reports' && (
            <div className="detail-action-bar">
              <button className={`sset-btn ${dirtyRef.current ? 'dirty' : ''}`} onClick={doSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
              {!isNew && (<button className="sset-btn sset-btn-primary" onClick={doExecute} disabled={executing || selectedIds.length === 0}>{executing ? '⟳ 执行中...' : '执行'}</button>)}
            </div>
          )}
        </div>
      </div>

      {/* Add Scenario Modal */}
      {showAddScenarioModal && (
        <div className="sset-modal-overlay" onClick={() => setShowAddScenarioModal(false)}>
          <div className="sset-modal sset-modal-list-page" style={{ width: modalWidth }} onClick={e => e.stopPropagation()}>
            <div className="sset-modal-header">
              <h3>添加场景</h3>
              <button className="sset-modal-close" onClick={() => setShowAddScenarioModal(false)}>×</button>
            </div>
            <div className="sset-modal-filters">
              <div className="sset-modal-filter-row">
                <div className="sset-modal-filter-item"><label>场景名称</label><input placeholder="搜索名称" value={addModalKeyword} onChange={e => setAddModalKeyword(e.target.value)} /></div>
                <div className="sset-modal-filter-item"><label>描述</label><input placeholder="搜索描述" value={addModalDesc} onChange={e => setAddModalDesc(e.target.value)} /></div>
                <div className="sset-modal-filter-item"><label>标签</label><input placeholder="搜索标签" value={addModalTags} onChange={e => setAddModalTags(e.target.value)} /></div>
                <div className="sset-modal-filter-item"><label>状态</label><select value={addModalStatus} onChange={e => setAddModalStatus(e.target.value)}><option value="">全部状态</option><option value="active">启用</option><option value="disabled">禁用</option><option value="draft">草稿</option></select></div>
              </div>
              <div className="sset-modal-filter-row">
                <div className="sset-modal-filter-actions">
                  <button className="sset-btn-query" onClick={() => fetchAddableScenarios(1, addModalPageSize)}>查询</button>
                  <button className="sset-btn-reset" onClick={() => { setAddModalKeyword(''); setAddModalDesc(''); setAddModalTags(''); setAddModalStatus(''); }}>重置</button>
                </div>
              </div>
            </div>
            <div className="sset-modal-table-wrap">
              {addModalLoading ? (<div className="sset-modal-empty">加载中...</div>) : addModalScenarios.length === 0 ? (<div className="sset-modal-empty">无匹配场景</div>) : (
                <table className="sset-table">
                  <thead><tr><th style={{ width: 40 }}><input type="checkbox" checked={addModalScenarios.length > 0 && addModalScenarios.every(s => addModalChecked.has(s.id))} onChange={e => { if (e.target.checked) setAddModalChecked(prev => { const next = new Set(prev); addModalScenarios.forEach(s => next.add(s.id)); return next; }); else setAddModalChecked(prev => { const next = new Set(prev); addModalScenarios.forEach(s => next.delete(s.id)); return next; }); }} /></th><th>场景名称</th><th>描述</th><th>标签</th><th>状态</th><th>创建时间</th></tr></thead>
                  <tbody>{addModalScenarios.map(s => (
                    <tr key={s.id}>
                      <td><input type="checkbox" checked={addModalChecked.has(s.id)} onChange={() => setAddModalChecked(prev => { const next = new Set(prev); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })} /></td>
                      <td>{s.name}</td>
                      <td className="td-desc">{s.description || '-'}</td>
                      <td>{s.tags ? s.tags.split(',').filter(Boolean).map(t => (<span key={t} className="tag-badge">{t.trim()}</span>)) : '-'}</td>
                      <td><span className={`sset-status-badge status-${s.status}`}>{s.status === 'active' ? '启用' : s.status === 'disabled' ? '禁用' : '草稿'}</span></td>
                      <td>{s.created_at.replace('T', ' ').slice(0, 16)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <div className="sset-modal-pagination">
              <div className="sset-modal-pagination-left">
                <span className="page-info">共 {addModalTotal} 条</span>
                <select className="page-size-select" value={addModalPageSize} onChange={e => fetchAddableScenarios(1, Number(e.target.value))}><option value={10}>10条/页</option><option value={20}>20条/页</option><option value={50}>50条/页</option><option value={100}>100条/页</option></select>
                <button className="page-btn" disabled={addModalPage <= 1} onClick={() => fetchAddableScenarios(addModalPage - 1, addModalPageSize)}>上一页</button>
                <span>{addModalPage} / {Math.ceil(addModalTotal / addModalPageSize) || 1}</span>
                <button className="page-btn" disabled={addModalPage >= Math.ceil(addModalTotal / addModalPageSize)} onClick={() => fetchAddableScenarios(addModalPage + 1, addModalPageSize)}>下一页</button>
              </div>
              <div className="sset-modal-pagination-right">
                <button className="sset-btn-cancel" onClick={() => setShowAddScenarioModal(false)}>取消</button>
                <button className="sset-btn-add-checked" disabled={addModalChecked.size === 0} onClick={addCheckedScenarios}>添加选中（{addModalChecked.size}）</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
