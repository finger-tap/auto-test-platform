import { useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { apiFetch, apiFetchLocal } from '../utils/api';
import { notification } from '../utils/notification';
import './ImportToTeamModal.css';
import { useModalKeyboard } from '../hooks/useModalKeyboard';

/**
 * Local → Team import wizard:
 *   step 1  pick resources from THIS local instance (export preview tree,
 *           checkboxes per type; dependency closure auto-adds on build)
 *   step 2  conflict preview against the team project (name + content hash)
 *           with per-item strategy: skip / overwrite / copy
 *   step 3  commit → summary
 * Also offers downloading the .atpkg (JSON) for archive/transfer.
 */

type PreviewTree = Record<string, Array<{ id: number; name: string; deps?: number }>>;

interface ConflictItem {
  type: string;
  localId: number;
  name: string;
  action: 'create' | 'conflict' | 'same';
  teamId?: number;
}

interface Summary {
  [type: string]: { created: number; overwritten: number; skipped: number; copied: number };
}

const TYPE_LABELS: Record<string, string> = {
  apis: '接口用例', scenarios: '场景', scenario_sets: '场景集',
  web_cases: 'Web 用例', pc_cases: 'PC 用例', mobile_cases: '移动端用例',
  case_sets_web: 'Web 用例集', case_sets_pc: 'PC 用例集', case_sets_mobile: '移动端用例集',
  environments: '环境配置', mocks_api: 'Mock（接口）', mocks_web: 'Mock（Web）',
  mocks_pc: 'Mock（PC）', mocks_mobile: 'Mock（移动端）',
};

const ORDER = ['apis', 'scenarios', 'scenario_sets', 'web_cases', 'pc_cases', 'mobile_cases', 'case_sets_web', 'case_sets_pc', 'case_sets_mobile', 'environments', 'mocks_api', 'mocks_web', 'mocks_pc', 'mocks_mobile'];

interface LocalAccount {
  id: number;
  account: string;
  nickname: string | null;
  stats: { apis: number; scenarios: number; webCases: number; pcCases: number; mobileCases: number; environments: number };
}

/**
 * mode 'self'         - 导入"我自己"的本机资源 (原行为)
 * mode 'pick-account' - 2026-08-23 用户设计: 团队空间里选一个本地账号, 把它的
 *                        个人数据同步进团队项目 (走 /team/local-accounts/* 桥)。
 */
export default function ImportToTeamModal({
  onClose,
  mode = 'self',
}: {
  onClose: () => void;
  mode?: 'self' | 'pick-account';
}) {
  // Esc 关闭统一 (2026-08-27)
  useModalKeyboard(true, onClose);
  const { workspace, projects } = useWorkspace();
  const [step, setStep] = useState<0 | 1 | 2 | 3>(mode === 'pick-account' ? 0 : 1);
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const [picked, setPicked] = useState<LocalAccount | null>(null);
  const [tree, setTree] = useState<PreviewTree | null>(null);
  const [checked, setChecked] = useState<Record<string, Set<number>>>({});
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [pkg, setPkg] = useState<Record<string, unknown> | null>(null);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [strategies, setStrategies] = useState<Record<string, Record<string, string>>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);

  if (workspace.mode !== 'team') return null;
  const teamId = workspace.teamId;
  const projectId = workspace.projectId;
  const projectName = projects.find((p) => p.id === projectId)?.name ?? '';

  useEffect(() => {
    if (mode === 'pick-account') {
      apiFetch<{ accounts: LocalAccount[] }>('/team/local-accounts')
        .then((res) => setAccounts(res.data?.accounts ?? []))
        .catch((e) => notification.error(e instanceof Error ? e.message : '读取本地账号列表失败'));
      return;
    }
    apiFetchLocal<PreviewTree>('/export-package/preview')
      .then((res) => {
        const t = res.data as PreviewTree | null;
        setTree(t ?? null);
        // default: check everything that exists
        const c: Record<string, Set<number>> = {};
        for (const [k, list] of Object.entries(t ?? {})) c[k] = new Set(list.map((i) => i.id));
        setChecked(c);
      })
      .catch((e) => notification.error(e instanceof Error ? e.message : '读取本机资源失败'));
  }, []);

  /** 选中本地账号后加载它的资源树 (团队桥端点, 走中心会话)。 */
  const pickAccount = async (a: LocalAccount) => {
    setBusy(true);
    try {
      const res = await apiFetch<PreviewTree>(`/team/local-accounts/${a.id}/preview?teamId=${teamId}`);
      const t = res.data as PreviewTree | null;
      setTree(t ?? null);
      const c: Record<string, Set<number>> = {};
      for (const [k, list] of Object.entries(t ?? {})) c[k] = new Set(list.map((i) => i.id));
      setChecked(c);
      setPicked(a);
      setStep(1);
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '读取该账号资源失败');
    } finally {
      setBusy(false);
    }
  };

  const totalCount = useMemo(
    () => ORDER.reduce((n, t) => n + (checked[t]?.size ?? 0), 0),
    [checked],
  );

  const toggleItem = (type: string, id: number) => {
    setChecked((prev) => {
      const s = new Set(prev[type] ?? []);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return { ...prev, [type]: s };
    });
  };
  const toggleType = (type: string, on: boolean) => {
    setChecked((prev) => ({
      ...prev,
      [type]: on ? new Set((tree?.[type] ?? []).map((i) => i.id)) : new Set(),
    }));
  };

  const buildPackage = async (): Promise<Record<string, unknown> | null> => {
    const body: Record<string, unknown> = { includeSecrets };
    for (const t of ORDER) body[t] = [...(checked[t] ?? [])];
    if (mode === 'pick-account') {
      if (!picked) return null;
      const res = await apiFetch<Record<string, unknown>>(`/team/local-accounts/${picked.id}/build`, {
        method: 'POST',
        body: JSON.stringify({ teamId, selections: body, includeSecrets }),
      });
      return res.data ?? null;
    }
    const res = await apiFetchLocal<Record<string, unknown>>('/export-package/build', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return res.data ?? null;
  };

  const toStep2 = async () => {
    if (totalCount === 0) {
      notification.warning('请至少选择一个资源');
      return;
    }
    setBusy(true);
    try {
      const p = await buildPackage();
      if (!p) throw new Error('构建导入包失败');
      setPkg(p);
      const res = await apiFetch<{ items: ConflictItem[] }>('/team/import/preview', {
        method: 'POST',
        body: JSON.stringify({ package: p, teamId, projectId }),
      });
      const items = res.data?.items ?? [];
      setConflicts(items);
      // default strategies: same→skip, conflict→copy, create→create
      const st: Record<string, Record<string, string>> = {};
      for (const it of items) {
        st[it.type] ??= {};
        st[it.type][String(it.localId)] = it.action === 'create' ? 'create' : it.action === 'same' ? 'skip' : 'copy';
      }
      setStrategies(st);
      setStep(2);
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '预览失败');
    } finally {
      setBusy(false);
    }
  };

  const setStrategy = (item: ConflictItem, s: string) => {
    setStrategies((prev) => ({
      ...prev,
      [item.type]: { ...(prev[item.type] ?? {}), [String(item.localId)]: s },
    }));
  };

  const commit = async () => {
    if (!pkg) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ summary: Summary }>('/team/import/commit', {
        method: 'POST',
        body: JSON.stringify({ package: pkg, teamId, projectId, strategies }),
      });
      setSummary(res.data?.summary ?? null);
      setStep(3);
      notification.success('导入完成');
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const downloadPkg = async () => {
    const p = pkg ?? (await buildPackage());
    if (!p) return;
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `autotest-package-${new Date().toISOString().slice(0, 10)}.atpkg.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const conflictItems = conflicts.filter((c) => c.action === 'conflict');
  const sameItems = conflicts.filter((c) => c.action === 'same');
  const createItems = conflicts.filter((c) => c.action === 'create');

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg itm-modal">
        <div className="modal-header">
          <div className="modal-title">导入本机资源 → {workspace.teamName} / {projectName || '（未选项目）'}</div>
          <button className="modal-close" onClick={onClose} title="关闭">×</button>
        </div>

        <div className="itm-steps">
          {mode === 'pick-account' && (
            <>
              <span className={`itm-step ${step >= 0 ? 'on' : ''}`}>0 选择账号</span>
              <span className="itm-step-arrow">{'->'}</span>
            </>
          )}
          <span className={`itm-step ${step >= 1 ? 'on' : ''}`}>1 选择资源</span>
          <span className="itm-step-arrow">→</span>
          <span className={`itm-step ${step >= 2 ? 'on' : ''}`}>2 冲突处理</span>
          <span className="itm-step-arrow">→</span>
          <span className={`itm-step ${step >= 3 ? 'on' : ''}`}>3 完成</span>
        </div>

        <div className="modal-body itm-body">
          {step === 0 && (
            <>
              <div className="itm-hint">选择要把哪个本地账号的个人数据同步进团队（公司服务器上的所有个人账户都在这里）。</div>
              {accounts.length === 0 && <div className="itm-empty">没有本地账号</div>}
              {accounts.map((a) => {
                const s = a.stats;
                const total = s.apis + s.scenarios + s.webCases + s.pcCases + s.mobileCases;
                return (
                  <button
                    key={a.id}
                    className="itm-account-row"
                    disabled={busy}
                    onClick={() => void pickAccount(a)}
                  >
                    <span className="itm-account-name">{a.nickname || a.account}</span>
                    <span className="itm-account-sub">{a.account}</span>
                    <span className="itm-account-stats">
                      {total === 0
                        ? '无数据'
                        : `接口 ${s.apis} · 场景 ${s.scenarios} · Web ${s.webCases} · PC ${s.pcCases} · 移动 ${s.mobileCases}`}
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {step === 1 && (
            !tree ? (
              <div className="itm-empty">读取本机资源中…</div>
            ) : (
              <>
                <div className="itm-hint">
                  {mode === 'pick-account' && picked && <b>账号「{picked.nickname || picked.account}」- </b>}
                  勾选要导入{mode === 'pick-account' ? '的该账号' : '的本机'}资源。导入场景集/用例集时会自动带上其引用的场景和用例（依赖闭包）。
                  <label className="itm-secrets">
                    <input type="checkbox" checked={includeSecrets} onChange={(e) => setIncludeSecrets(e.target.checked)} />
                    包含环境中的敏感变量（数据库密码等，默认脱敏）
                  </label>
                </div>
                {ORDER.filter((t) => (tree[t]?.length ?? 0) > 0).map((type) => {
                  const list = tree[type] ?? [];
                  const sel = checked[type] ?? new Set();
                  const all = sel.size === list.length;
                  return (
                    <div key={type} className="itm-group">
                      <label className="itm-group-head">
                        <input
                          type="checkbox"
                          checked={all}
                          onChange={(e) => toggleType(type, e.target.checked)}
                        />
                        <span>{TYPE_LABELS[type] ?? type}</span>
                        <span className="itm-count">{sel.size}/{list.length}</span>
                      </label>
                      <div className="itm-items">
                        {list.map((it) => (
                          <label key={it.id} className={`itm-item ${sel.has(it.id) ? 'on' : ''}`}>
                            <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggleItem(type, it.id)} />
                            <span className="itm-item-name">{it.name}</span>
                            {it.deps ? <span className="itm-dep">引 {it.deps} 项</span> : null}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {totalCount === 0 && <div className="itm-empty">本机没有可导入的资源</div>}
              </>
            )
          )}

          {step === 2 && (
            <>
              <div className="itm-hint">
                共 {conflicts.length} 项：🆕 新增 {createItems.length} ｜ ⚠️ 同名冲突 {conflictItems.length} ｜ =️ 内容相同 {sameItems.length}
              </div>
              {conflictItems.length > 0 && (
                <div className="itm-group">
                  <div className="itm-group-head itm-conflict-head">⚠️ 同名且内容不同 — 请选择处理方式</div>
                  {conflictItems.map((it) => (
                    <div key={`${it.type}-${it.localId}`} className="itm-conflict-row">
                      <span className="itm-type-tag">{TYPE_LABELS[it.type] ?? it.type}</span>
                      <span className="itm-item-name">{it.name}</span>
                      <select
                        className="form-select itm-strategy"
                        value={strategies[it.type]?.[String(it.localId)] ?? 'copy'}
                        onChange={(e) => setStrategy(it, e.target.value)}
                      >
                        <option value="skip">跳过（保留团队版）</option>
                        <option value="overwrite">覆盖团队版（原版已存历史）</option>
                        <option value="copy">保留两者（建副本）</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
              {sameItems.length > 0 && (
                <div className="itm-group">
                  <div className="itm-group-head">=️ 内容相同（将跳过）</div>
                  <div className="itm-items">
                    {sameItems.map((it) => (
                      <span key={`${it.type}-${it.localId}`} className="itm-item same">{TYPE_LABELS[it.type]} · {it.name}</span>
                    ))}
                  </div>
                </div>
              )}
              {createItems.length > 0 && (
                <div className="itm-group">
                  <div className="itm-group-head">🆕 新增</div>
                  <div className="itm-items">
                    {createItems.map((it) => (
                      <span key={`${it.type}-${it.localId}`} className="itm-item on">{TYPE_LABELS[it.type]} · {it.name}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {step === 3 && summary && (
            <>
              <div className="itm-done">✅ 导入完成</div>
              <table className="itm-summary-table">
                <thead>
                  <tr><th>类型</th><th>新增</th><th>覆盖</th><th>副本</th><th>跳过</th></tr>
                </thead>
                <tbody>
                  {ORDER.filter((t) => summary[t] && (summary[t].created + summary[t].overwritten + summary[t].copied + summary[t].skipped) > 0).map((t) => (
                    <tr key={t}>
                      <td>{TYPE_LABELS[t] ?? t}</td>
                      <td>{summary[t].created}</td>
                      <td>{summary[t].overwritten}</td>
                      <td>{summary[t].copied}</td>
                      <td>{summary[t].skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="modal-footer">
          {step === 0 && (
            <button className="btn btn-default" onClick={onClose}>取消</button>
          )}

          {step === 1 && (
            <>
              <button className="btn btn-default" onClick={() => void downloadPkg()}>⬇ 下载 .atpkg</button>
              <button className="btn btn-default" onClick={onClose}>取消</button>
              <button className="btn btn-primary" disabled={busy || totalCount === 0} onClick={() => void toStep2()}>
                {busy ? '分析中…' : `下一步（已选 ${totalCount} 项）`}
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button className="btn btn-default" onClick={() => setStep(1)}>上一步</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void commit()}>
                {busy ? '导入中…' : '开始导入'}
              </button>
            </>
          )}
          {step === 3 && (
            <button className="btn btn-primary" onClick={onClose}>完成</button>
          )}
        </div>
      </div>
    </div>
  );
}
