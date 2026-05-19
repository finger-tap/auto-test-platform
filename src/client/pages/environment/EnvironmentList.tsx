import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import type { Environment, EnvVariable } from '../../types';

import './EnvironmentList.css';

export default function EnvironmentList() {
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [deletingId, setDeletingId] = useState<number | null>(null);

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
    if (!confirm(`确认删除环境「${env.name}」？`)) return;
    setDeletingId(env.id);
    const res = await apiFetch(`/environments/${env.id}`, { method: 'DELETE' });
    setDeletingId(null);
    if (res.code === 200) {
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
      // Sync active env to context immediately
      setActiveEnv(env);
      // Reload list to get updated is_default status
      load();
    }
  }

  return (
    <div className="elist">
      <div className="elist-head">
        <h2>环境管理</h2>
        <button className="elist-btn-create" onClick={() => navigate('/api-test/environment/new')}>+ 新建环境</button>
      </div>

      {loading ? (
        <div className="elist-empty">加载中...</div>
      ) : envs.length === 0 ? (
        <div className="elist-empty">
          <p>暂无环境</p>
          <button className="elist-btn-create" onClick={() => navigate('/api-test/environment/new')}>+ 新建第一个环境</button>
        </div>
      ) : (
        <div className="elist-cards">
          {envs.map(env => {
            const isActive = activeEnv?.id === env.id;
            const varsRaw = normalizeVars(env.variables);
            const varCount = varsRaw.filter((v) => v.key?.trim()).length;
            const hasCert = !!env.ssl_cert?.trim();
            const hasKey = !!env.ssl_key?.trim();

            return (
              <div key={env.id} className={`elist-card${isActive ? ' is-active' : ''}`}>
                <div className="elist-card-info">
                  <div className="elist-card-name-row">
                    {isActive && <span className="elist-card-dot" />}
                    <span className="elist-card-name">{env.name}</span>
                  </div>
                  <div className="elist-card-meta">
                    <span>变量 {varCount} 个</span>
                    {hasCert && <span>🔒 证书</span>}
                    {hasKey && <span>🔑 密钥</span>}
                    <span>超时 {((env.timeout || 30000) / 1000)}s</span>
                  </div>
                </div>
                <div className="elist-card-actions">
                  {isActive && <span className="elist-active-tag">使用中</span>}
                  <button className="elist-btn-use" onClick={() => useEnv(env)}>使用此环境</button>
                  <button className="elist-btn-edit" title="编辑" onClick={() => navigate(`/api-test/environment/${env.id}`)}>✎</button>
                  <button className="elist-btn-del" title="删除" onClick={() => doDelete(env)} disabled={deletingId === env.id}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}