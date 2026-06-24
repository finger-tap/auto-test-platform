import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import notification from '../../utils/notification';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import FormSelect from '../../components/FormSelect';
import type { Environment, EnvVariable } from '../../types';

import './EnvironmentList.css';

export default function EnvironmentList({ basePath = '/api-test' }: { basePath?: string } = {}) {
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [fName, setFName] = useState('');
  const [appliedName, setAppliedName] = useState('');
  const [fDefault, setFDefault] = useState('');
  const [appliedDefault, setAppliedDefault] = useState('');

  const navigate = useNavigate();
  const { activeEnv, setActiveEnv } = useEnvironment();

  function normalizeVars(v: Environment['variables']): EnvVariable[] {
    if (!v) return [];
    if (typeof v === 'string') {
      try { return JSON.parse(v); } catch { return []; }
    }
    if (Array.isArray(v)) {
      return v.map(item => {
        if (typeof item === 'string') {
          try { return JSON.parse(item); } catch { return null; }
        }
        return item;
      }).filter(Boolean) as EnvVariable[];
    }
    return [];
  }

  function load() {
    setLoading(true);
    // 环境是 4 种测试类型共享的基础设施，不按 test_type 过滤
    apiFetch<Environment[]>('/environments').then(res => {
      if (res.code === 200) setEnvs(res.data || []);
    }).finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const onEnvChanged = () => load();
    window.addEventListener('envs-changed', onEnvChanged);
    return () => window.removeEventListener('envs-changed', onEnvChanged);
  }, []);

  async function doDelete(env: Environment) {
    const ok = await notification.confirm(`确认删除环境「${env.name}」？`);
    if (!ok) return;
    await apiFetch(`/environments/${env.id}`, { method: 'DELETE' });
    load();
    if (activeEnv?.id === env.id) {
      apiFetch<Environment[]>('/environments').then(r => {
        if (r.code === 200) {
          const def = r.data?.find(e => e.is_default === 1);
          setActiveEnv(def || null);
        }
      });
    }
  }

  async function useEnv(env: Environment) {
    const varsToSend = normalizeVars(env.variables);
    const res = await apiFetch<Environment>(`/environments/${env.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: env.name,
        variables: varsToSend,
        ssl_cert: env.ssl_cert,
        ssl_key: env.ssl_key,
        timeout: env.timeout,
        is_default: true,
      }),
    });
    if (res.code === 200) {
      setActiveEnv(env);
      load();
    }
  }

  // 本地按名称和默认状态过滤（点击查询按钮后生效）
  const filtered = envs.filter(env => {
    if (appliedName && !env.name.toLowerCase().includes(appliedName.toLowerCase())) return false;
    if (appliedDefault === 'yes' && env.is_default !== 1) return false;
    if (appliedDefault === 'no' && env.is_default === 1) return false;
    return true;
  });

  function handleQuery() {
    setAppliedName(fName);
    setAppliedDefault(fDefault);
  }

  function handleReset() {
    setFName('');
    setAppliedName('');
    setFDefault('');
    setAppliedDefault('');
  }

  return (
    <div className="elist page-enter">
      {/* Filter Area */}
      <div className="alist-filter">
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>环境名称</label>
            <input placeholder="搜索环境" value={fName} onChange={e => setFName(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>是否默认</label>
            <FormSelect
              value={fDefault}
              options={[{ value: '', label: '全部' }, { value: 'yes', label: '默认环境' }, { value: 'no', label: '非默认' }]}
              onChange={val => setFDefault(val)}
            />
          </div>
          <div className="alist-filter-actions">
            <button className="btn btn-primary" onClick={handleQuery}>查询</button>
            <button className="btn btn-default" onClick={handleReset}>重置</button>
            <button className="btn btn-default" onClick={() => navigate(`${basePath}/environment/new`)}>新增</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="alist-table-wrap">
        {loading ? (
          <div className="elist-empty">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="elist-empty">
            <p>暂无环境</p>
            <button className="elist-btn-create" onClick={() => navigate(`${basePath}/environment/new`)}>+ 新建第一个环境</button>
          </div>
        ) : (
          <table className="elist-table">
            <thead>
              <tr>
                <th>环境名称</th>
                <th>变量数</th>
                <th>SSL证书</th>
                <th>超时</th>
                <th>默认</th>
                <th>创建时间</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((env, index) => {
                const isActive = activeEnv?.id === env.id;
                const varsRaw = normalizeVars(env.variables);
                const varCount = varsRaw.filter((v) => v.key?.trim()).length;
                const hasCert = !!env.ssl_cert?.trim();
                const hasKey = !!env.ssl_key?.trim();

                return (
                  <tr key={env.id} className="row-enter" style={{ '--delay': `${index * 30}ms`, cursor: 'pointer' } as React.CSSProperties} onClick={() => navigate(`${basePath}/environment/${env.id}`)}>
                    <td>
                      {isActive && <span className="elist-card-dot" style={{ display: 'inline-block', marginRight: 6 }} />}
                      {env.name}
                    </td>
                    <td>{varCount} 个</td>
                    <td>{hasCert ? '✅' : '-'}{hasKey && ' 🔑'}</td>
                    <td>{((env.timeout || 30000) / 1000)}s</td>
                    <td>{isActive ? <span className="elist-active-tag">当前使用中</span> : '-'}</td>
                    <td>{formatDateTime(env.created_at)}</td>
                    <td>
                      <div className="row-actions">
                        {!isActive && (
                          <button className="row-action-btn" title="设为默认" onClick={(e) => { e.stopPropagation(); useEnv(env); }}>设为默认</button>
                        )}
                        <button className="row-action-btn row-action-del" title="删除" onClick={(e) => { e.stopPropagation(); doDelete(env); }}>删除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}