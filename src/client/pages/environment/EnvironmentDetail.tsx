import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import FormSelect from '../../components/FormSelect';
import { apiFetch } from '../../utils/api';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import type { Environment, EnvVariable, SslCertEntry } from '../../types';
import notification from '../../utils/notification';
import './EnvironmentDetail.css';

// Database entry type (matches backend)
interface DbEntry {
  name: string;
  type: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export default function EnvironmentDetail({ basePath = '/api-test' }: { basePath?: string } = {}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const [loading, setLoading] = useState(!isNew);

  const [name, setName] = useState('');
  const [reqTimeout, setReqTimeout] = useState(30000);
  const [isDefault, setIsDefault] = useState(false);
  const [sslCerts, setSslCerts] = useState<SslCertEntry[]>([]);
  const [vars, setVars] = useState<EnvVariable[]>([]);
  // Multiple databases
  const [dbs, setDbs] = useState<DbEntry[]>([]);
  const [testingConn, setTestingConn] = useState(false);
  const [connTestMsg, setConnTestMsg] = useState('');
  const [connTestOk, setConnTestOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [variables, setVariables] = useState<EnvVariable[]>([]);
  const [dirty, setDirty] = useState(false);
  const { activeEnv, setActiveEnv } = useEnvironment();

  useEffect(() => {
    if (!isNew) {
      apiFetch<Environment>(`/environments/${id}`).then(res => {
        if (res.code === 200 && res.data) {
          const e = res.data;
          setName(e.name || '');
          setReqTimeout(e.timeout || 30000);
          setIsDefault(e.is_default === 1);
          // Parse ssl_certs JSON array; fall back to legacy single cert
          if (e.ssl_certs) {
            try {
              const parsed = JSON.parse(e.ssl_certs);
              setSslCerts(Array.isArray(parsed) && parsed.length > 0 ? parsed : []);
            } catch {
              setSslCerts([]);
            }
          } else if (e.ssl_cert) {
            setSslCerts([{ name: '默认证书', cert: e.ssl_cert, key: e.ssl_key || '' }]);
          } else {
            setSslCerts([]);
          }
          // e.variables may be: (1) JSON string, (2) array of objects, (3) array of JSON strings
          let varsArr: EnvVariable[] = [];
          if (typeof e.variables === 'string') {
            try { varsArr = JSON.parse(e.variables || '[]'); } catch { varsArr = []; }
          } else if (Array.isArray(e.variables)) {
            varsArr = e.variables.map(v => {
              if (typeof v === 'string') {
                try { return JSON.parse(v); } catch { return null; }
              }
              return v;
            }).filter(Boolean) as EnvVariable[];
          }
          setVars(varsArr.length > 0 ? varsArr : [{ key: '', value: '', enabled: true }]);
          // Multiple databases: parse from JSON string
          if (e.databases) {
            try {
              const parsed = JSON.parse(e.databases);
              setDbs(Array.isArray(parsed) && parsed.length > 0 ? parsed : []);
            } catch {
              setDbs([]);
            }
          } else {
            setDbs([]);
          }
          setDirty(false);
        }
      }).finally(() => setLoading(false));
    }
  }, [id, isNew]);

  function addVar() {
    setVars([...vars, { key: '', value: '', enabled: true }]);
    setDirty(true);
  }

  function removeVar(i: number) {
    setVars(vars.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  function updateVar(i: number, field: keyof EnvVariable, value: string | boolean) {
    const updated = [...vars];
    updated[i] = { ...updated[i], [field]: value };
    setVars(updated);
    setDirty(true);
  }

  // ── Database helpers ──
  function addDb() {
    setDbs([...dbs, { name: '', type: 'mysql', host: '', port: 3306, user: '', password: '', database: '' }]);
    setDirty(true);
  }

  function removeDb(i: number) {
    setDbs(dbs.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  function updateDb(i: number, field: keyof DbEntry, value: string | number) {
    const updated = [...dbs];
    updated[i] = { ...updated[i], [field]: value };
    // Auto-set port based on type
    if (field === 'type') {
      updated[i].port = value === 'postgres' ? 5432 : 3306;
    }
    setDbs(updated);
    setDirty(true);
  }

  // ── SSL cert helpers ──
  function addSslCert() {
    setSslCerts([...sslCerts, { name: '', cert: '', key: '' }]);
    setDirty(true);
  }

  function removeSslCert(i: number) {
    setSslCerts(sslCerts.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  function updateSslCert(i: number, field: keyof SslCertEntry, value: string) {
    const updated = [...sslCerts];
    updated[i] = { ...updated[i], [field]: value };
    setSslCerts(updated);
    setDirty(true);
  }

  function handleCertFileUpload(i: number, field: 'cert' | 'key', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      updateSslCert(i, field, text);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function testDbConn(entry: DbEntry) {
    if (!entry.host) {
      setConnTestMsg('请先填写主机地址');
      setConnTestOk(false);
      return;
    }
    setTestingConn(true);
    setConnTestMsg('');
    try {
      const res = await apiFetch<{ success: boolean; message?: string }>('/environments/test-db', {
        method: 'POST',
        body: JSON.stringify({
          type: entry.type,
          host: entry.host,
          port: entry.port || (entry.type === 'mysql' ? 3306 : 5432),
          user: entry.user,
          password: entry.password,
          database: entry.database,
        }),
      });
      setConnTestOk(res.data?.success ?? false);
      setConnTestMsg(res.data?.message || (res.data?.success ? '连接成功' : '连接失败'));
    } catch {
      setConnTestOk(false);
      setConnTestMsg('连接失败，请检查配置');
    }
    setTestingConn(false);
  }

  async function doSave() {
    if (!name.trim()) {
      notification.warning('请输入环境名称');
      return;
    }
    const cleanVars = vars.filter(v => v.key.trim());
    // Filter out empty db entries
    const cleanDbs = dbs.filter(d => d.name.trim() && d.host.trim());
    // Filter out empty SSL cert entries
    const cleanSslCerts = sslCerts.filter(c => c.cert.trim());
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        variables: cleanVars,
        ssl_certs: cleanSslCerts,
        timeout: reqTimeout,
        is_default: isDefault,
        databases: cleanDbs,
      };
      let res;
      if (isNew) {
        res = await apiFetch<Environment>('/environments', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } else {
        res = await apiFetch<Environment>(`/environments/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      }
      if (res.code === 200) {
        setDirty(false);
        if (res.data && activeEnv?.id === res.data.id) {
          setActiveEnv(res.data);
        }
        window.dispatchEvent(new Event('envs-changed'));
        notification.success('保存成功');
        if (isNew) {
          window.setTimeout(() => navigate(`${basePath}/environment`), 1200);
        }
      } else {
        notification.error(res.message || '保存失败');
      }
    } catch {
      notification.error('保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="api-empty">加载中...</div>;
  }

  return (
    <div className="api-detail env-detail-page page-enter">
      <div className="api-detail-header">
        <div className="api-detail-breadcrumb">
          <button className="api-detail-back" onClick={() => navigate(`${basePath}/environment`)}>环境列表</button>
          <span className="api-detail-breadcrumb-sep">/</span>
          <input className="api-detail-name-input" value={name} onChange={e => { setName(e.target.value); setDirty(true); }} placeholder="输入环境名称" />
        </div>
        <div className="api-detail-actions">
          <button className={`scenario-btn${dirty ? ' dirty' : ''}`} onClick={doSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>

      <div className="api-detail-content">
        <div className="envdt-form">
          {/* Basic Info Card */}
          <div className="ad-section">
            <div className="ad-section-head"><label>基本信息</label></div>
            <div className="api-detail-row">
              <div className="field">
                <label>环境名称 <span className="required">*</span></label>
                <input type="text" value={name} onChange={e => { setName(e.target.value); setDirty(true); }} placeholder="如：测试环境、生产环境" />
              </div>
            </div>
            <div className="api-detail-row">
              <div className="field">
                <label>超时时间（毫秒）</label>
                <input type="number" value={reqTimeout} onChange={e => { setReqTimeout(Number(e.target.value)); setDirty(true); }} />
              </div>
              <div className="field">
                <label>默认环境</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8 }}>
                  <label className="rule-switch">
                    <input type="checkbox" checked={isDefault} onChange={e => { setIsDefault(e.target.checked); setDirty(true); }} />
                    <span className="rule-switch-slider" />
                  </label>
                  <span style={{ fontSize: 13, color: 'var(--fg)' }}>{isDefault ? '已设为默认' : '设为默认'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* SSL Card */}
          <div className="ad-section">
            <div className="ad-section-head"><label>SSL 客户端证书（可选）</label></div>
            <div className="envdt-card-desc">
              当目标接口使用双向 TLS（mTLS）认证时，需要上传客户端证书（.pem/.crt）和对应的私钥（.key）。可配置多组证书，在 API 详情页按名称选择使用哪组。
            </div>

            {/* SSL cert list */}
            {sslCerts.length > 0 && (
              <div className="envdt-db-list">
                {sslCerts.map((cert, i) => (
                  <div key={i} className="envdt-db-card">
                    <div className="envdt-db-card-header">
                      <input
                        className="envdt-db-name"
                        placeholder="证书别名，如：测试证书、生产证书"
                        value={cert.name}
                        onChange={e => updateSslCert(i, 'name', e.target.value)}
                      />
                      <button className="envdt-db-del" onClick={() => removeSslCert(i)}>✕</button>
                    </div>
                    <div className="envdt-db-fields">
                      <div className="envdt-field">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <label>SSL 证书（.pem）</label>
                          <label className="envdt-upload-btn">
                            上传文件
                            <input type="file" accept=".pem,.crt,.cer" style={{ display: 'none' }} onChange={e => handleCertFileUpload(i, 'cert', e)} />
                          </label>
                        </div>
                        <textarea
                          value={cert.cert}
                          onChange={e => updateSslCert(i, 'cert', e.target.value)}
                          placeholder="粘贴 .pem 证书内容或证书链"
                          rows={3}
                        />
                      </div>
                      <div className="envdt-field">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <label>SSL 私钥（.key）</label>
                          <label className="envdt-upload-btn">
                            上传文件
                            <input type="file" accept=".pem,.key" style={{ display: 'none' }} onChange={e => handleCertFileUpload(i, 'key', e)} />
                          </label>
                        </div>
                        <textarea
                          value={cert.key}
                          onChange={e => updateSslCert(i, 'key', e.target.value)}
                          placeholder="粘贴 .key 私钥内容"
                          rows={3}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button className="ad-btn ad-btn-sm" onClick={addSslCert}>+ 添加证书</button>
          </div>

          {/* Variables Card */}
          <div className="ad-section">
            <div className="ad-section-head"><label>环境变量</label></div>
            <div className="envdt-card-desc">
              变量可在接口请求的 URL、请求头、请求体中使用，语法为 <code>{'{{variable_name}}'}</code>。
            </div>
          {vars.length > 0 && (
            <div className="envdt-var-head">
              <span>变量名</span>
              <span>变量值</span>
              <span>描述</span>
              <span></span>
            </div>
          )}
          <div className="envdt-var-list">
            {vars.map((v, i) => (
              <div key={i} className="envdt-var-row">
                <input placeholder="key" value={v.key} onChange={e => updateVar(i, 'key', e.target.value)} />
                <input placeholder="value" value={v.value} onChange={e => updateVar(i, 'value', e.target.value)} />
                <input placeholder="描述（可选）" value={v.description || ''} onChange={e => updateVar(i, 'description', e.target.value)} />
                <button className="envdt-var-del" onClick={() => removeVar(i)}>✕</button>
              </div>
            ))}
          </div>
          <button className="ad-btn ad-btn-sm" onClick={addVar}>+ 添加变量</button>
        </div>

        {/* Database Card */}
        <div className="ad-section">
          <div className="ad-section-head"><label>数据库连接（可选）</label></div>
          <div className="envdt-card-desc">
            配置数据库连接后，前置/后置动作中可选择该数据库并填写 SQL，自动查询数据传入执行上下文。
          </div>

          {/* Database list */}
          {dbs.length > 0 && (
            <div className="envdt-db-list">
              {dbs.map((db, i) => (
                <div key={i} className="envdt-db-card">
                  <div className="envdt-db-card-header">
                    <input
                      className="envdt-db-name"
                      placeholder="数据库别名，如：用户库、订单库"
                      value={db.name}
                      onChange={e => updateDb(i, 'name', e.target.value)}
                    />
                    <button className="envdt-db-del" onClick={() => removeDb(i)}>✕</button>
                  </div>
                  <div className="envdt-db-fields">
                    <div className="envdt-field envdt-field-row">
                      <div className="envdt-field" style={{ flex: 0, width: 120 }}>
                        <label>类型</label>
                        <FormSelect
                          value={db.type}
                          options={[
                            { value: 'mysql', label: 'MySQL' },
                            { value: 'postgres', label: 'PostgreSQL' },
                          ]}
                          onChange={v => updateDb(i, 'type', v)}
                        />
                      </div>
                      <div className="envdt-field" style={{ flex: 2 }}>
                        <label>主机</label>
                        <input value={db.host} onChange={e => updateDb(i, 'host', e.target.value)} placeholder="localhost 或 IP" />
                      </div>
                      <div className="envdt-field" style={{ flex: 0, width: 100 }}>
                        <label>端口</label>
                        <input type="number" value={db.port || ''} onChange={e => updateDb(i, 'port', Number(e.target.value))} placeholder={db.type === 'mysql' ? '3306' : '5432'} />
                      </div>
                    </div>
                    <div className="envdt-field envdt-field-row">
                      <div className="envdt-field">
                        <label>用户名</label>
                        <input value={db.user} onChange={e => updateDb(i, 'user', e.target.value)} placeholder="用户名" />
                      </div>
                      <div className="envdt-field">
                        <label>密码</label>
                        <input type="password" value={db.password} onChange={e => updateDb(i, 'password', e.target.value)} placeholder="密码" />
                      </div>
                      <div className="envdt-field">
                        <label>数据库名</label>
                        <input value={db.database} onChange={e => updateDb(i, 'database', e.target.value)} placeholder="数据库名" />
                      </div>
                    </div>
                    <div className="envdt-field envdt-db-test-row">
                      <button
                        className="envdt-test-btn"
                        onClick={() => testDbConn(db)}
                        disabled={testingConn}
                      >
                        {testingConn ? '测试中...' : '测试连接'}
                      </button>
                      {connTestMsg && (
                        <span className={`conn-test-msg ${connTestOk ? 'ok' : 'err'}`}>{connTestMsg}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="ad-btn ad-btn-sm" onClick={addDb}>+ 添加数据库</button>
        </div>
      </div>


      </div>
    </div>
  );
}