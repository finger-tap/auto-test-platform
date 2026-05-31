import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { toLocalDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import { InlineText, InlineSelect } from '../../components/InlineEdit';
import FormSelect from '../../components/FormSelect';
import TagInput from '../../components/TagInput';
import type { Scenario, ScenarioSetExecution, ScenarioSetExecutionItem } from '../../types';
import ScenarioExecutionTimeline from '../../components/ScenarioExecutionTimeline';
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

// 根据测试类型映射到对应的 API 路径
const API_PATH_MAP: Record<string, { list: string; detail: string; create: string; delete: string }> = {
  api: { list: '/scenario-sets', detail: '/scenario-sets', create: '/scenario-sets', delete: '/scenario-sets' },
  web: { list: '/scenario-sets-web', detail: '/scenario-sets-web', create: '/scenario-sets-web', delete: '/scenario-sets-web' },
  pc: { list: '/scenario-sets-pc', detail: '/scenario-sets-pc', create: '/scenario-sets-pc', delete: '/scenario-sets-pc' },
  mobile: { list: '/scenario-sets-mobile', detail: '/scenario-sets-mobile', create: '/scenario-sets-mobile', delete: '/scenario-sets-mobile' },
};

// 根据测试类型映射场景 API 路径
const SCENARIO_API_PATH_MAP: Record<string, { list: string }> = {
  api: { list: '/scenarios' },
  web: { list: '/scenarios-web' },
  pc: { list: '/scenarios-pc' },
  mobile: { list: '/scenarios-mobile' },
};

const TABS = [
  { key: 'detail', label: '场景集详情' },
  { key: 'scenarios', label: '场景列表' },
  { key: 'reports', label: '执行记录' },
];

export default function ScenarioSetDetail({ basePath = '/api-test', testType = 'api' }: { basePath?: string; testType?: string }) {
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
  const [setExecutions, setSetExecutions] = useState<ScenarioSetExecution[]>([]);
  const [expandedReport, setExpandedReport] = useState<number | null>(null);
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<number>>(new Set());
  const [expandedScenarioItem, setExpandedScenarioItem] = useState<number | null>(null);
  const [modalWidth, setModalWidth] = useState('80%');
  const [expandedSetExec, setExpandedSetExec] = useState<number | null>(null);
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
      const apiPath = API_PATH_MAP[testType] || API_PATH_MAP.api;
      apiFetch<SetDetail>(`${apiPath.detail}/${id}`).then(res => {
        if (res.code === 200 && res.data) {
          setSetData(res.data); setName(res.data.name); setDescription(res.data.description || '');
          setTags(res.data.tags || ''); setStatus(res.data.status || 'draft'); setSelectedIds(res.data.scenario_ids);
          originalRef.current = { name: res.data.name, description: res.data.description || '', tags: res.data.tags || '', status: res.data.status || 'draft', selectedIds: [...res.data.scenario_ids] };
          dirtyRef.current = false;
        }
      }).finally(() => setLoading(false));
           apiFetch<SavedReport[]>(`${apiPath.detail}/${id}/reports`).then(res => { if (res.code === 200) setReports(res.data || []); });
    apiFetch<ScenarioSetExecution[]>(`${apiPath.detail}/${id}/executions`).then(res => {
      if (res.code === 200 && res.data && res.data.length > 0) {
        setSetExecutions(res.data);
      }
    });
    }
  }, [id]);

  useEffect(() => {
    const scenarioApiPath = SCENARIO_API_PATH_MAP[testType] || SCENARIO_API_PATH_MAP.api;
    apiFetch<{ items: Scenario[] }>(`${scenarioApiPath.list}?page=1&pageSize=1000`).then(res => { if (res.code === 200) setAllScenarios(res.data?.items || []); });
  }, []);

  // Fetch full execution detail with steps when an execution row is expanded
  useEffect(() => {
    if (!expandedSetExec || !id) return;
    const apiPath = API_PATH_MAP[testType] || API_PATH_MAP.api;
    apiFetch<ScenarioSetExecution>(`${apiPath.detail}/${id}/executions/${expandedSetExec}`).then(res => {
      if (res.code === 200 && res.data) {
        setSetExecutions(prev => prev.map(exec => exec.id === expandedSetExec ? res.data! : exec));
      }
    });
  }, [expandedSetExec, id]);

  function handleFieldChange(setter: React.Dispatch<React.SetStateAction<string>>, value: string) { setter(value); dirtyRef.current = true; }
  function handleStatusChange(value: string) { setStatus(value); dirtyRef.current = true; }

  async function doSave() {
    if (!name.trim()) return;
    setSaving(true);
    const apiPath = API_PATH_MAP[testType] || API_PATH_MAP.api;
    const routeBase = testType === 'api' ? '/api-test/scene-set' : testType === 'web' ? '/web-test/scene-set' : testType === 'pc' ? '/pc-test/scene-set' : '/mobile-test/scene-set';
    try {
      if (isNew) {
        const res = await apiFetch<{ id: number }>(apiPath.list, { method: 'POST', body: JSON.stringify({ name: name.trim(), description, tags, status, scenario_ids: selectedIds }) });
        if (res.code === 201 && res.data) { notification.success('保存成功'); setTimeout(() => navigate(`${routeBase}/${res.data!.id}`), 300); }
      } else {
        await apiFetch(`${apiPath.detail}/${id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim(), description, tags, status, scenario_ids: selectedIds }) });
        dirtyRef.current = false;
        notification.success('保存成功');
      }
    } finally { setSaving(false); }
  }

  async function doExecute() {
    if (!id || isNew || selectedIds.length === 0) return;
    setExecuting(true);
    const apiPath = API_PATH_MAP[testType] || API_PATH_MAP.api;
    try {
      if (dirtyRef.current) await doSave();
      const res = await apiFetch<ScenarioSetExecution>(`${apiPath.detail}/${id}/execute`, { method: 'POST', body: JSON.stringify({ environmentId: activeEnv?.id }) });
      if (res.code === 200) {
        setActiveTab('reports');
        const [reportRes, execRes] = await Promise.all([
          apiFetch<SavedReport[]>(`${apiPath.detail}/${id}/reports`),
          apiFetch<ScenarioSetExecution[]>(`${apiPath.detail}/${id}/executions`),
        ]);
        if (reportRes.code === 200) setReports(reportRes.data || []);
        if (execRes.code === 200 && execRes.data && execRes.data.length > 0) {
          setSetExecutions(execRes.data);
        }
      }
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
      const scenarioApiPath = SCENARIO_API_PATH_MAP[testType] || SCENARIO_API_PATH_MAP.api;
      const res = await apiFetch<{ items: Scenario[]; total: number }>(`${scenarioApiPath.list}?page=${pageNum}&pageSize=${pageSz}`);
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

  // ─── Tab: Detail ───
  const renderDetailTab = () => (
    <div className="tab-content-wrapper">
      <div className="sset-info-section">
        <div className="sset-info-row">
          <div className="sset-info-field"><label>名称</label><InlineText value={name} onChange={v => handleFieldChange(setName, v)} placeholder="点击输入集名称" /></div>
        </div>
        <div className="sset-info-row">
          <div className="sset-info-field"><label>描述</label><InlineText value={description || ''} onChange={v => handleFieldChange(setDescription, v)} placeholder="点击输入描述" multiline /></div>
        </div>
        <div className="sset-info-row">
          <div className="sset-info-field">
            <label>标签</label>
            <TagInput
              value={tags || ''}
              onChange={v => handleFieldChange(setTags, v)}
              placeholder="输入标签，回车确认"
            />
          </div>
          <div className="sset-info-field sset-info-field-inline"><label>状态</label><InlineSelect value={status} options={STATUS_OPTIONS} onChange={handleStatusChange} renderDisplay={(v, label) => <span className={`sset-status-badge status-${v}`}>{label}</span>} /></div>
        </div>
        {!isNew && (
          <div className="sset-info-row">
            <div className="sset-info-field"><label>创建时间</label><span className="sset-field-value">{toLocalDateTime(setData?.created_at)}</span></div>
            <div className="sset-info-field"><label>更新时间</label><span className="sset-field-value">{toLocalDateTime(setData?.updated_at)}</span></div>
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
                  <button className="sset-btn-text" onClick={() => navigate(`${scenarioRouteBase}/${s.id}`)}>查看详情</button>
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
  const renderReportsTab = () => {
    const displayExecutions = [...setExecutions].sort((a, b) =>
      (b.started_at || '').localeCompare(a.started_at || '')
    );

    const renderExecItem = (execItem: ScenarioSetExecution) => {
      const isExpanded = expandedSetExec === execItem.id;
      return (
        <>
          <tr key={execItem.id} className="sset-exec-row" onClick={() => setExpandedSetExec(isExpanded ? null : execItem.id)}>
            <td>{toLocalDateTime(execItem.started_at)}</td>
            <td>
              <span className={`sset-exec-status sset-exec-${execItem.status}`}>{execItem.status}</span>
            </td>
            <td>{execItem.total_count}</td>
            <td>
              <span className="sset-exec-pass">{execItem.passed_count}</span>
              <span className="sset-exec-sep">/</span>
              <span className="sset-exec-fail">{execItem.failed_count}</span>
           </td>
            <td>{execItem.total_duration_ms != null ? `${execItem.total_duration_ms}ms` : '-'}</td>
            <td>{execItem.executed_by || '-'}</td>
            <td>{isExpanded ? '收起' : '展开'}</td>
          </tr>
          {isExpanded && execItem.items && execItem.items.map((item, i) => {
            const itemExpanded = expandedScenarioItem === item.id;
            return (
              <>
                <tr key={`row-${i}`} className="sset-exec-item-row" onClick={() => setExpandedScenarioItem(itemExpanded ? null : item.id)}>
                  <td>{item.scenario_name}</td>
                  <td><span className={`scenario-log-status scenario-log-${item.status}`}>{item.status}</span></td>
                  <td></td>
                  <td></td>
                  <td>{item.duration_ms != null ? `${item.duration_ms}ms` : '-'}</td>
                  <td></td>
                  <td>{itemExpanded ? '收起' : '展开'}</td>
                </tr>
                {itemExpanded && (
                  <tr className="sset-exec-item-detail-row"><td colSpan={7}>
                    {item.scenario_execution?.steps && item.scenario_execution.steps.length > 0 ? (
                      <ScenarioExecutionTimeline
                        steps={item.scenario_execution.steps}
                        apiLinks={item.scenario_execution.api_links || []}
                        cacheKeyPrefix={`sset-${execItem.id}-item-${item.id}`}
                      />
                    ) : (
                      <div className="sset-exec-no-steps">{item.scenario_execution_id ? '加载步骤中...' : '无执行步骤'}</div>
                    )}
                  </td></tr>
                )}
              </>
            );
          })}
        </>
      );
    };

    return (
      <div className="tab-content-wrapper">
        {displayExecutions.length === 0 && reports.length === 0 ? (
          <div className="sset-empty">暂无执行记录</div>
        ) : (
          <>
            {displayExecutions.length > 0 && (
              <table className="sset-exec-table">
                <thead><tr><th>执行时间</th><th>状态</th><th>总数</th><th>结果</th><th>耗时</th><th>执行人</th><th>操作</th></tr></thead>
                <tbody>
                  {displayExecutions.map(exec => renderExecItem(exec))}
                </tbody>
              </table>
            )}
            {reports.length > 0 && (
              <div className="sset-old-reports">
                <div className="sset-old-reports-title">历史报告</div>
                {reports.map((r, idx) => {
                  const total = r.passed + r.failed;
                  const rate = total > 0 ? Math.round((r.passed / total) * 100) : 0;
                  return (
                    <div key={r.id || idx} className="sset-report-row">
                      <div className="sset-report-summary" onClick={() => setExpandedReport(expandedReport === r.id ? null : r.id)}>
                        <div className="sset-report-time">{toLocalDateTime(r.executed_at)}</div>
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
          </>
        )}
      </div>
    );
  };

  const scenarioRouteBase = testType === 'api' ? '/api-test/scene-case' : testType === 'web' ? '/web-test/scene' : testType === 'pc' ? '/pc-test/scene' : '/mobile-test/scene-case';
  const setRouteBase = testType === 'api' ? '/api-test/scene-set' : testType === 'web' ? '/web-test/scene-set' : testType === 'pc' ? '/pc-test/scene-set' : '/mobile-test/scene-set';

  return (
    <div className="sset-detail">
      <div className="sset-detail-header">
        <button className="sset-back" onClick={() => navigate(setRouteBase)}>← 返回列表</button>
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
                <div className="sset-modal-filter-item"><label>状态</label><FormSelect value={addModalStatus} options={[{value:"",label:"全部状态"},{value:"active",label:"启用"},{value:"disabled",label:"禁用"},{value:"draft",label:"草稿"}]} onChange={val => setAddModalStatus(val)} /></div>
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
                <FormSelect value={String(addModalPageSize)} options={[{value:"10",label:"10条/页"},{value:"20",label:"20条/页"},{value:"50",label:"50条/页"},{value:"100",label:"100条/页"}]} onChange={val => fetchAddableScenarios(1, Number(val))} />
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
