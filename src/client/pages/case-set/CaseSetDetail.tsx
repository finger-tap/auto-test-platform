import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch, apiFetchBlob } from '../../utils/api';
import { toLocalDateTime, formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import { InlineText, InlineSelect } from '../../components/InlineEdit';
import FormSelect from '../../components/FormSelect';
import TagInput from '../../components/TagInput';
import DevicePickerModal, { type PickerDevice } from '../../components/DevicePickerModal';
import type { Scenario, WebTestCase, PcTestCase, MobileTestCase, CaseSetExecution, CaseSetExecutionItem } from '../../types';
import './CaseSetDetail.css';

type TestCase = Scenario | WebTestCase | PcTestCase | MobileTestCase;

interface SetDetail {
  id: number;
  name: string;
  description: string | null;
  tags: string;
  status: string;
  test_case_ids: number[];
  created_at: string;
  updated_at: string;
}

const STATUS_OPTIONS = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

// 用例集 API 路径按测试类型映射
// - api: 仍走 /scenario-sets（沿用"场景集"概念）
// - web/pc/mobile: 走 /case-sets-{web,pc,mobile}
const API_PATH_MAP: Record<string, { list: string; detail: string; create: string; delete: string }> = {
  api: { list: '/scenario-sets', detail: '/scenario-sets', create: '/scenario-sets', delete: '/scenario-sets' },
  web: { list: '/case-sets-web', detail: '/case-sets-web', create: '/case-sets-web', delete: '/case-sets-web' },
  pc: { list: '/case-sets-pc', detail: '/case-sets-pc', create: '/case-sets-pc', delete: '/case-sets-pc' },
  mobile: { list: '/case-sets-mobile', detail: '/case-sets-mobile', create: '/case-sets-mobile', delete: '/case-sets-mobile' },
};

// 用例（添加候选）API 路径按测试类型映射
// - api: /scenarios
// - web: /web-cases
// - pc: /pc-cases
// - mobile: /mobile-tests
const TEST_CASE_API_PATH_MAP: Record<string, { list: string }> = {
  api: { list: '/scenarios' },
  web: { list: '/web-cases' },
  pc: { list: '/pc-cases' },
  mobile: { list: '/mobile-tests' },
};

const TABS = [
  { key: 'detail', label: '详情' },
  { key: 'cases', label: '用例列表' },
  { key: 'reports', label: '执行记录' },
];

export default function CaseSetDetail({ basePath = '/api-test', testType = 'api' }: { basePath?: string; testType?: string }) {
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
  const [allCases, setAllCases] = useState<TestCase[]>([]);
  const [caseKeyword, setCaseKeyword] = useState('');
  const [addModalKeyword, setAddModalKeyword] = useState('');
  const [addModalDesc, setAddModalDesc] = useState('');
  const [addModalTags, setAddModalTags] = useState('');
  const [addModalStatus, setAddModalStatus] = useState('');
  const [addModalPage, setAddModalPage] = useState(1);
  const [addModalPageSize, setAddModalPageSize] = useState(10);
  const [addModalTotal, setAddModalTotal] = useState(0);
  const [addModalChecked, setAddModalChecked] = useState<Set<number>>(new Set());
  const [addModalLoading, setAddModalLoading] = useState(false);
  const [showAddCaseModal, setShowAddCaseModal] = useState(false);
  const [addModalCases, setAddModalCases] = useState<TestCase[]>([]);
  const [executing, setExecuting] = useState(false);
  const [setExecutions, setSetExecutions] = useState<CaseSetExecution[]>([]);
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<number>>(new Set());
  const [modalWidth, setModalWidth] = useState('80%');
  const [expandedSetExec, setExpandedSetExec] = useState<number | null>(null);
  // 远程设备选择（web/pc 测试类型）
  const [selectedDevice, setSelectedDevice] = useState<PickerDevice | null>(null);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const { activeEnv } = useEnvironment();
  const originalRef = useRef({ name: '', description: '', tags: '', status: 'draft', selectedIds: [] as number[] });
  const [isDirty, setIsDirty] = useState(false);
  const [activeTab, setActiveTab] = useState('detail');

  const isCaseSet = testType !== 'api';
  const detailTitle = isCaseSet ? '用例集详情' : '场景集详情';
  const listTitle = isCaseSet ? '用例列表' : '场景列表';
  const casesFieldName = isCaseSet ? '用例' : '场景';
  const executeButtonLabel = isCaseSet ? '执行全部用例' : '执行全部场景';
  const addModalTitle = isCaseSet ? '添加用例' : '添加场景';
  const fieldName = isCaseSet ? 'test_case_ids' : 'scenario_ids';
  const filterCaseIdParam = isCaseSet ? 'case_ids' : 'scenario_ids';

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
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape' && showAddCaseModal) setShowAddCaseModal(false); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showAddCaseModal]);

  useEffect(() => {
    if (isNew) setIsDirty(!!(name || description || tags || selectedIds.length > 0));
    else setIsDirty(
      name !== originalRef.current.name || description !== originalRef.current.description ||
      tags !== originalRef.current.tags || status !== originalRef.current.status ||
      JSON.stringify([...selectedIds].sort()) !== JSON.stringify([...originalRef.current.selectedIds].sort()));
  }, [name, description, tags, status, selectedIds]);

  useEffect(() => {
    if (!isNew && id) {
      const apiPath = API_PATH_MAP[testType] || API_PATH_MAP.api;
      apiFetch<SetDetail>(`${apiPath.detail}/${id}`).then(res => {
        if (res.code === 200 && res.data) {
          setSetData(res.data); setName(res.data.name); setDescription(res.data.description || '');
          setTags(res.data.tags || ''); setStatus(res.data.status || 'draft'); setSelectedIds(res.data.test_case_ids);
          originalRef.current = { name: res.data.name, description: res.data.description || '', tags: res.data.tags || '', status: res.data.status || 'draft', selectedIds: [...res.data.test_case_ids] };
          setIsDirty(false);
        }
      }).finally(() => setLoading(false));
      apiFetch<CaseSetExecution[]>(`${apiPath.detail}/${id}/executions`).then(res => {
        if (res.code === 200 && res.data && res.data.length > 0) {
          setSetExecutions(res.data);
        }
      });
    }
  }, [id]);

  useEffect(() => {
    const caseApiPath = TEST_CASE_API_PATH_MAP[testType] || TEST_CASE_API_PATH_MAP.api;
    apiFetch<{ items: TestCase[] }>(`${caseApiPath.list}?page=1&pageSize=1000`).then(res => { if (res.code === 200) setAllCases(res.data?.items || []); });
  }, []);

  // Fetch full execution detail with items when an execution row is expanded
  useEffect(() => {
    if (!expandedSetExec || !id) return;
    const apiPath = API_PATH_MAP[testType] || API_PATH_MAP.api;
    apiFetch<CaseSetExecution>(`${apiPath.detail}/${id}/executions/${expandedSetExec}`).then(res => {
      if (res.code === 200 && res.data) {
        setSetExecutions(prev => prev.map(exec => exec.id === expandedSetExec ? res.data! : exec));
      }
    });
  }, [expandedSetExec, id]);

  function handleFieldChange(setter: React.Dispatch<React.SetStateAction<string>>, value: string) { setter(value); setIsDirty(true); }
  function handleStatusChange(value: string) { setStatus(value); setIsDirty(true); }

  async function doSave() {
    if (!name.trim()) return;
    setSaving(true);
    const apiPath = API_PATH_MAP[testType] || API_PATH_MAP.api;
    const routeBase = testType === 'api' ? '/api-test/case-set' : testType === 'web' ? '/web-test/case-set' : testType === 'pc' ? '/pc-test/case-set' : '/mobile-test/case-set';
    try {
      if (isNew) {
        const body: Record<string, unknown> = { name: name.trim(), description, tags, status };
        body[fieldName] = selectedIds;
        const res = await apiFetch<{ id: number }>(apiPath.list, { method: 'POST', body: JSON.stringify(body) });
        if (res.code === 201 && res.data) { notification.success('保存成功'); setTimeout(() => navigate(`${routeBase}/${res.data!.id}`), 300); }
      } else {
        const body: Record<string, unknown> = { name: name.trim(), description, tags, status };
        body[fieldName] = selectedIds;
        await apiFetch(`${apiPath.detail}/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        setIsDirty(false);
        notification.success('保存成功');
      }
    } catch (err) { notification.error(err instanceof Error ? err.message : '保存失败'); } finally { setSaving(false); }
  }

  async function doExecute(caseIdsToRun?: number[]) {
    if (!id || isNew || selectedIds.length === 0) return;
    setExecuting(true);
    const apiPath = API_PATH_MAP[testType] || API_PATH_MAP.api;
    try {
      if (isDirty) await doSave();
      const body: Record<string, unknown> = { environmentId: activeEnv?.id };
      if (caseIdsToRun && caseIdsToRun.length > 0) body[filterCaseIdParam] = caseIdsToRun;
      // 传递远程设备 ID（web/pc 类型）
      if (selectedDevice && typeof selectedDevice.id === 'number') {
        body.deviceId = selectedDevice.id;
      }
      const res = await apiFetch<CaseSetExecution>(`${apiPath.detail}/${id}/execute`, { method: 'POST', body: JSON.stringify(body) });
      if (res.code === 200) {
        setActiveTab('reports');
        const execRes = await apiFetch<CaseSetExecution[]>(`${apiPath.detail}/${id}/executions`);
        if (execRes.code === 200 && execRes.data && execRes.data.length > 0) {
          setSetExecutions(execRes.data);
        }
      }
    } catch (err) { notification.error(err instanceof Error ? err.message : '执行失败'); } finally { setExecuting(false); }
  }

  function toggleCase(caseId: number) {
    setSelectedIds(prev => prev.includes(caseId) ? prev.filter(i => i !== caseId) : [...prev, caseId]);
    setSelectedForRemoval(prev => { const next = new Set(prev); next.delete(caseId); return next; });
  }

  function addCases(ids: number[]) { setSelectedIds(prev => [...new Set([...prev, ...ids])]); setShowAddCaseModal(false); }

  const fetchAddableCases = async (pageNum = 1, pageSz = addModalPageSize) => {
    try {
      setAddModalLoading(true);
      const caseApiPath = TEST_CASE_API_PATH_MAP[testType] || TEST_CASE_API_PATH_MAP.api;
      const res = await apiFetch<{ items: TestCase[]; total: number }>(`${caseApiPath.list}?page=${pageNum}&pageSize=${pageSz}`);
      if (res.code === 200 && res.data) {
        let items = res.data.items.filter(s => !selectedIds.includes(s.id));
        if (addModalKeyword) { const kw = addModalKeyword.toLowerCase(); items = items.filter(s => s.name.toLowerCase().includes(kw)); }
        if (addModalDesc) { const kw = addModalDesc.toLowerCase(); items = items.filter(s => ((s as any).description || '').toLowerCase().includes(kw)); }
        if (addModalTags) { const kw = addModalTags.toLowerCase(); items = items.filter(s => ((s as any).tags || '').toLowerCase().includes(kw)); }
        if (addModalStatus) items = items.filter(s => (s as any).status === addModalStatus);
        setAddModalTotal(res.data.total); setAddModalCases(items); setAddModalPage(pageNum); setAddModalPageSize(pageSz);
      }
    } finally { setAddModalLoading(false); }
  };

  function openAddModal() {
    setAddModalKeyword(''); setAddModalDesc(''); setAddModalTags(''); setAddModalStatus('');
    setAddModalPage(1); setAddModalChecked(new Set());
    fetchAddableCases(1, 10);
    setShowAddCaseModal(true);
  }

  function addCheckedCases() { if (addModalChecked.size === 0) return; addCases(Array.from(addModalChecked)); }

  function toggleCheck(caseId: number) { setSelectedForRemoval(prev => { const next = new Set(prev); if (next.has(caseId)) next.delete(caseId); else next.add(caseId); return next; }); }
  function removeChecked() { if (selectedForRemoval.size === 0) return; setSelectedIds(prev => prev.filter(id => !selectedForRemoval.has(id))); setSelectedForRemoval(new Set()); }

  if (loading) return <div className="api-empty">加载中...</div>;

  const selectedCases = allCases.filter(s => selectedIds.includes(s.id));
  const filteredSelected = selectedCases.filter(s => s.name.toLowerCase().includes(caseKeyword.toLowerCase()));

  // ─── Tab: Detail ───
  const renderDetailTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head"><label>基本信息</label></div>
        <div className="api-detail-row">
          <div className="field"><label>名称</label><InlineText value={name} onChange={v => handleFieldChange(setName, v)} placeholder="点击输入集名称" /></div>
        </div>
        <div className="api-detail-row">
          <div className="field"><label>描述</label><InlineText value={description || ''} onChange={v => handleFieldChange(setDescription, v)} placeholder="点击输入描述" multiline /></div>
        </div>
        <div className="api-detail-row">
          <div className="field">
            <label>标签</label>
            <TagInput
              value={tags || ''}
              onChange={v => handleFieldChange(setTags, v)}
              placeholder="输入标签，回车确认"
            />
          </div>
          <div className="field"><label>状态</label><InlineSelect value={status} options={STATUS_OPTIONS} onChange={handleStatusChange} renderDisplay={(v, label) => <span className={`sset-status-badge status-${v}`}>{label}</span>} /></div>
        </div>
        {!isNew && (
          <div className="api-detail-row">
            <div className="field"><label>创建时间</label><span className="field-value">{toLocalDateTime(setData?.created_at)}</span></div>
            <div className="field"><label>更新时间</label><span className="field-value">{toLocalDateTime(setData?.updated_at)}</span></div>
          </div>
        )}
      </div>
    </div>
  );

  // ─── Tab: Cases ───
  const renderCasesTab = () => (
    <div className="tab-content-wrapper">
      <div className="ad-section">
        <div className="ad-section-head">
          <label>{listTitle}（{selectedCases.length} 个）</label>
          <div className="sset-scenario-actions">
            <input className="sset-scenario-search" placeholder={`搜索${casesFieldName}名称`} value={caseKeyword} onChange={e => setCaseKeyword(e.target.value)} />
            <button className="sset-btn-add" onClick={openAddModal}>{`+ 添加${casesFieldName}`}</button>
            {selectedForRemoval.size > 0 && (<button className="sset-btn-remove-checked" onClick={removeChecked}>移除选中（{selectedForRemoval.size}）</button>)}
          </div>
        </div>
      {selectedCases.length === 0 ? (<div className="sset-empty">{`暂无${casesFieldName}，点击上方"添加${casesFieldName}"进行选择`}</div>) : (
        <table className="sset-table">
          <thead><tr><th style={{ width: 40 }}><input type="checkbox" checked={filteredSelected.length > 0 && filteredSelected.every(s => selectedForRemoval.has(s.id))} onChange={e => { if (e.target.checked) setSelectedForRemoval(new Set(filteredSelected.map(s => s.id))); else setSelectedForRemoval(new Set()); }} /></th><th>{casesFieldName}名称</th><th>状态</th><th style={{ width: 160 }}>操作</th></tr></thead>
          <tbody>
            {filteredSelected.map(s => (
              <tr key={s.id}>
                <td><input type="checkbox" checked={selectedForRemoval.has(s.id)} onChange={() => toggleCheck(s.id)} /></td>
                <td>{s.name}</td>
                <td><span className={`sset-status-badge status-${(s as any).status}`}>{(s as any).status === 'active' ? '启用' : (s as any).status === 'disabled' ? '禁用' : '草稿'}</span></td>
                <td>
                  <button className="sset-btn-text" onClick={() => navigate(`${caseRouteBase}/${s.id}`)}>查看详情</button>
                  <button className="sset-btn-text sset-btn-text-danger" onClick={() => toggleCase(s.id)}>移除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </div>
    </div>
  );

  // ─── Tab: Reports ───
  const renderReportsTab = () => {
    const displayExecutions = [...setExecutions].sort((a, b) =>
      (b.started_at || '').localeCompare(a.started_at || '')
    );

    const renderExecItem = (execItem: CaseSetExecution) => {
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
          {isExpanded && execItem.items && execItem.items.map((item: CaseSetExecutionItem) => (
            <tr key={`item-${item.id}`} className="sset-exec-item-row">
              <td colSpan={2}>{item.case_name}</td>
              <td><span className={`sset-exec-status sset-exec-${item.status}`}>{item.status}</span></td>
              <td>
                {item.status === 'success' ? (
                  <span className="sset-exec-pass">通过</span>
                ) : item.status === 'failed' ? (
                  <span className="sset-exec-fail">失败</span>
                ) : item.status === 'skipped' ? (
                  <span style={{ color: '#999' }}>跳过</span>
                ) : (
                  <span style={{ color: '#999' }}>{item.status}</span>
                )}
              </td>
              <td>{item.duration_ms != null ? `${item.duration_ms}ms` : '-'}</td>
              <td colSpan={2}>
                {item.report_url ? (
                  <a href={item.report_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                    查看报告
                  </a>
                ) : (
                  <span style={{ color: '#999' }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </>
      );
    };

    async function doExportReport() {
      if (!id) return;
      const apiPath = API_PATH_MAP[testType] || API_PATH_MAP.api;
      try {
        const res = await apiFetchBlob(`${apiPath.detail}/${id}/export-report`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      } catch (e) {
        // export-report is only implemented for API scenario sets; silently no-op for case sets
      }
    }

    return (
      <div className="tab-content-wrapper">
        <div className="ad-section">
          <div className="ad-section-head">
            <label>执行记录</label>
            {!isCaseSet && displayExecutions.length > 0 && (
              <button className="sset-btn sset-btn-primary" onClick={doExportReport}>导出报告</button>
            )}
          </div>
          {isCaseSet && displayExecutions.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--fg-tertiary)', marginBottom: 12 }}>每条执行记录下的「查看报告」链接打开该用例的 Midscene 报告（新窗口）</div>
          )}
          {displayExecutions.length === 0 ? (
            <div className="sset-empty">暂无执行记录</div>
          ) : (
            <table className="sset-exec-table">
              <thead>
                <tr>
                  <th rowSpan={2}>执行时间</th>
                  <th rowSpan={2}>状态</th>
                  <th rowSpan={2}>总数</th>
                  <th rowSpan={2}>结果</th>
                  <th rowSpan={2}>耗时</th>
                  <th rowSpan={2}>执行人</th>
                  <th rowSpan={2}>操作</th>
                </tr>
              </thead>
              <tbody>
                {displayExecutions.map(exec => renderExecItem(exec))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  const caseRouteBase = testType === 'api' ? '/api-test/case' : testType === 'web' ? '/web-test/case' : testType === 'pc' ? '/pc-test/case' : '/mobile-test/case';
  const setRouteBase = testType === 'api' ? '/api-test/case-set' : testType === 'web' ? '/web-test/case-set' : testType === 'pc' ? '/pc-test/case-set' : '/mobile-test/case-set';

  return (
    <div className="api-detail page-enter">
      <div className="api-detail-header">
        <div className="api-detail-breadcrumb">
          <button className="api-detail-back" onClick={() => navigate(setRouteBase)}>用例集列表</button>
          <span className="api-detail-breadcrumb-sep">/</span>
          <input className="api-detail-name-input" value={name} onChange={e => handleFieldChange(setName, e.target.value)} placeholder="输入用例集名称" />
        </div>
        <div className="api-detail-meta">
          {!isNew && <span className={`status-badge-light ${status}`}>{STATUS_OPTIONS.find(o => o.value === status)?.label || status}</span>}
          {setData?.updated_at && <span className="meta-time">更新于 {toLocalDateTime(setData.updated_at)}</span>}
        </div>
        <div className="api-detail-actions">
          <button className={`scenario-btn${isDirty ? ' dirty' : ''}`} onClick={doSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
          {/* 远程设备选择（仅 web/pc 类型） */}
          {(testType === 'web' || testType === 'pc') && !isNew && (
            <button
              className="scenario-btn scenario-btn--outline"
              onClick={() => setShowDevicePicker(true)}
              title={selectedDevice ? `当前设备: ${selectedDevice.name}` : '选择远程执行设备'}
            >
              {selectedDevice ? `🖥 ${selectedDevice.name}` : '选择设备'}
            </button>
          )}
          {!isNew && (() => {
            const hasSelection = activeTab === 'cases' && selectedForRemoval.size > 0;
            const execIds = hasSelection ? Array.from(selectedForRemoval) : undefined;
            const label = hasSelection ? `执行选中（${selectedForRemoval.size}）` : executeButtonLabel;
            return <button className="sset-btn sset-btn-primary" onClick={() => { doExecute(execIds); if (hasSelection) setSelectedForRemoval(new Set()); }} disabled={executing || selectedIds.length === 0}>{executing ? '⟳ 执行中...' : label}</button>;
          })()}
        </div>
      </div>
      <div className="api-detail-content">
        <div className="api-detail-card">
          <div className="tab-nav">{TABS.map((tab) => (<button key={tab.key} className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>))}</div>
          <div className="tab-body">
            {activeTab === 'detail' && renderDetailTab()}
            {activeTab === 'cases' && renderCasesTab()}
            {activeTab === 'reports' && renderReportsTab()}
          </div>
        </div>
      </div>

      {/* Add Case Modal */}
      {showAddCaseModal && (
        <div className="sset-modal-overlay" onClick={() => setShowAddCaseModal(false)}>
          <div className="sset-modal sset-modal-list-page" style={{ width: modalWidth }} onClick={e => e.stopPropagation()}>
            <div className="sset-modal-header">
              <h3>{addModalTitle}</h3>
              <button className="sset-modal-close" onClick={() => setShowAddCaseModal(false)}>×</button>
            </div>
            <div className="sset-modal-filters">
              <div className="sset-modal-filter-row">
                <div className="sset-modal-filter-item"><label>{casesFieldName}名称</label><input placeholder="搜索名称" value={addModalKeyword} onChange={e => setAddModalKeyword(e.target.value)} /></div>
                <div className="sset-modal-filter-item"><label>描述</label><input placeholder="搜索描述" value={addModalDesc} onChange={e => setAddModalDesc(e.target.value)} /></div>
                <div className="sset-modal-filter-item"><label>标签</label><input placeholder="搜索标签" value={addModalTags} onChange={e => setAddModalTags(e.target.value)} /></div>
                <div className="sset-modal-filter-item"><label>状态</label><FormSelect value={addModalStatus} options={[{value:"",label:"全部状态"},{value:"active",label:"启用"},{value:"disabled",label:"禁用"},{value:"draft",label:"草稿"}]} onChange={val => setAddModalStatus(val)} /></div>
              </div>
              <div className="sset-modal-filter-row">
                <div className="sset-modal-filter-actions">
                  <button className="sset-btn-query" onClick={() => fetchAddableCases(1, addModalPageSize)}>查询</button>
                  <button className="sset-btn-reset" onClick={() => { setAddModalKeyword(''); setAddModalDesc(''); setAddModalTags(''); setAddModalStatus(''); }}>重置</button>
                </div>
              </div>
            </div>
            <div className="sset-modal-table-wrap">
              {addModalLoading ? (<div className="sset-modal-empty">加载中...</div>) : addModalCases.length === 0 ? (<div className="sset-modal-empty">{`无匹配${casesFieldName}`}</div>) : (
                <table className="sset-table">
                  <thead><tr><th style={{ width: 40 }}><input type="checkbox" checked={addModalCases.length > 0 && addModalCases.every(s => addModalChecked.has(s.id))} onChange={e => { if (e.target.checked) setAddModalChecked(prev => { const next = new Set(prev); addModalCases.forEach(s => next.add(s.id)); return next; }); else setAddModalChecked(prev => { const next = new Set(prev); addModalCases.forEach(s => next.delete(s.id)); return next; }); }} /></th><th>{casesFieldName}名称</th><th>描述</th><th>标签</th><th>状态</th><th>创建时间</th></tr></thead>
                  <tbody>{addModalCases.map(s => (
                    <tr key={s.id}>
                      <td><input type="checkbox" checked={addModalChecked.has(s.id)} onChange={() => setAddModalChecked(prev => { const next = new Set(prev); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })} /></td>
                      <td>{s.name}</td>
                      <td className="td-desc">{(s as any).description || '-'}</td>
                      <td>{(s as any).tags ? (s as any).tags.split(',').filter(Boolean).map((t: string) => (<span key={t} className="tag-badge">{t.trim()}</span>)) : '-'}</td>
                      <td><span className={`sset-status-badge status-${(s as any).status}`}>{(s as any).status === 'active' ? '启用' : (s as any).status === 'disabled' ? '禁用' : '草稿'}</span></td>
                      <td>{formatDateTime((s as any).created_at)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <div className="sset-modal-pagination">
              <div className="sset-modal-pagination-left">
                <span className="page-info">共 {addModalTotal} 条</span>
                <FormSelect value={String(addModalPageSize)} options={[{value:"10",label:"10条/页"},{value:"20",label:"20条/页"},{value:"50",label:"50条/页"},{value:"100",label:"100条/页"}]} onChange={val => fetchAddableCases(1, Number(val))} />
                <button className="page-btn" disabled={addModalPage <= 1} onClick={() => fetchAddableCases(addModalPage - 1, addModalPageSize)}>上一页</button>
                <span>{addModalPage} / {Math.ceil(addModalTotal / addModalPageSize) || 1}</span>
                <button className="page-btn" disabled={addModalPage >= Math.ceil(addModalTotal / addModalPageSize)} onClick={() => fetchAddableCases(addModalPage + 1, addModalPageSize)}>下一页</button>
              </div>
              <div className="sset-modal-pagination-right">
                <button className="sset-btn-cancel" onClick={() => setShowAddCaseModal(false)}>取消</button>
                <button className="sset-btn-add-checked" disabled={addModalChecked.size === 0} onClick={addCheckedCases}>添加选中（{addModalChecked.size}）</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Device Picker Modal (web/pc only) */}
      {(testType === 'web' || testType === 'pc') && (
        <DevicePickerModal
          open={showDevicePicker}
          testType={testType as 'web' | 'pc'}
          onClose={() => setShowDevicePicker(false)}
          onSelect={(device) => { setSelectedDevice(device); setShowDevicePicker(false); }}
          onLocalExecute={() => { setSelectedDevice(null); setShowDevicePicker(false); }}
        />
      )}
    </div>
  );
}
