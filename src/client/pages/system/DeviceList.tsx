import { useState, useEffect } from 'react';
import FormSelect from '../../components/FormSelect';
import { apiFetch } from '../../utils/api';
import notification from '../../utils/notification';
import './DeviceList.css';

type DeviceTestType = 'web' | 'pc' | 'mobile';
type DeviceStatus = 'online' | 'offline' | 'unknown';
type SshAuthType = 'password' | 'private_key';

interface DeviceRow {
  id: number;
  user_id: number;
  name: string;
  test_type: DeviceTestType;
  platform: string;
  serial: string | null;
  host: string | null;
  status: DeviceStatus;
  last_heartbeat: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  // 2026-06-06: agent fields. Populated on the list response when the
  // server has them (i.e. for web devices, after a heartbeat has been
  // received). Missing fields are normal for PC/mobile devices.
  agent_endpoint?: string | null;
  agent_version?: string | null;
  last_seen_at?: string | null;
  has_agent_token?: boolean;
  // 2026-06-07: SSH push fields. Plaintext credentials are NEVER
  // returned — only booleans + last-push audit trail.
  ssh_host?: string | null;
  ssh_port?: number | null;
  ssh_user?: string | null;
  ssh_auth_type?: SshAuthType | null;
  ssh_password?: string | null;       // never present in response
  ssh_private_key?: string | null;    // never present in response
  os_type?: string | null;
  needs_upgrade?: 0 | 1;
  has_ssh_password?: boolean;
  has_ssh_private_key?: boolean;
  last_push_at?: string | null;
  last_push_status?: 'ok' | 'error' | null;
  last_push_error?: string | null;
}

interface DeviceFormData {
  name: string;
  test_type: DeviceTestType;
  platform: string;
  serial: string;
  host: string;
  status: DeviceStatus;
  // 2026-06-07: SSH push fields (form is the only place plaintext
  // credentials live, and only briefly). Stored in component state,
  // POSTed to the server, then cleared. Edit mode re-fetches the
  // server's view via GET /:id so existing credentials stay private.
  ssh_host: string;
  ssh_port: string;        // string in form for the <input>, parsed on submit
  ssh_user: string;
  ssh_auth_type: SshAuthType | '';
  ssh_password: string;
  ssh_private_key: string;
  os_type: string;
}

const TEST_TYPE_OPTIONS: { value: DeviceTestType; label: string }[] = [
  { value: 'web', label: 'Web 测试' },
  { value: 'pc', label: 'PC 测试' },
  { value: 'mobile', label: '移动端测试' },
];

const STATUS_OPTIONS: { value: DeviceStatus; label: string; color: string }[] = [
  { value: 'online', label: '在线', color: 'success' },
  { value: 'offline', label: '离线', color: 'error' },
  { value: 'unknown', label: '未知', color: 'warning' },
];

const PLATFORM_PRESETS: Record<DeviceTestType, string[]> = {
  web: ['chromium', 'firefox', 'webkit'],
  pc: ['win', 'mac', 'linux'],
  mobile: ['android', 'ios', 'harmony'],
};

const EMPTY_FORM: DeviceFormData = {
  name: '',
  test_type: 'web',
  platform: 'chromium',
  serial: '',
  host: '',
  status: 'unknown',
  ssh_host: '',
  ssh_port: '22',
  ssh_user: '',
  ssh_auth_type: '',
  ssh_password: '',
  ssh_private_key: '',
  os_type: 'linux',
};

export default function DeviceList() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<DeviceTestType | ''>('');
  const [filterStatus, setFilterStatus] = useState<DeviceStatus | ''>('');
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState<DeviceRow | null>(null);
  const [form, setForm] = useState<DeviceFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showSshSection, setShowSshSection] = useState(false);
  // 2026-06-07: per-device push/stop loading state. Keyed by device id
  // so multiple buttons can show their own spinner.
  const [pushingId, setPushingId] = useState<number | null>(null);
  const [stoppingId, setStoppingId] = useState<number | null>(null);

  const fetchDevices = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterType) params.set('test_type', filterType);
    if (filterStatus) params.set('status', filterStatus);
    if (keyword.trim()) params.set('keyword', keyword.trim());
    const qs = params.toString();
    apiFetch<{ items: DeviceRow[] }>(`/devices${qs ? '?' + qs : ''}`).then(res => {
      if (res.code === 200 && res.data) {
        setDevices(res.data.items);
      } else {
        setDevices([]);
      }
    }).catch(() => {
      notification.error('加载设备失败');
      setDevices([]);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchDevices(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowSshSection(false);
    setShowForm(true);
  };

  const openEdit = (device: DeviceRow) => {
    setEditing(device);
    setForm({
      name: device.name,
      test_type: device.test_type,
      platform: device.platform,
      serial: device.serial || '',
      host: device.host || '',
      status: device.status,
      ssh_host: device.ssh_host || '',
      ssh_port: String(device.ssh_port ?? 22),
      ssh_user: device.ssh_user || '',
      ssh_auth_type: device.ssh_auth_type || '',
      // ssh_password / ssh_private_key are NEVER sent from the server.
      // The form starts blank; the user re-enters them to update.
      ssh_password: '',
      ssh_private_key: '',
      os_type: device.os_type || 'linux',
    });
    // Auto-expand the SSH section if the device already has any SSH
    // field filled in — the user is most likely here to update creds.
    setShowSshSection(!!(device.ssh_host || device.ssh_user || device.ssh_auth_type));
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowSshSection(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      notification.error('请填写设备名称');
      return;
    }
    if (!form.platform.trim()) {
      notification.error('请填写平台');
      return;
    }
    setSaving(true);
    try {
      // SSH fields are only included in the payload if the user actually
      // typed something — sending `ssh_password: ''` would clear the
      // stored credential, which is a footgun. For create, we always
      // send the form's value (empty string → null on the server).
      const sshHost = form.ssh_host.trim();
      const hasSshAuth = !!form.ssh_auth_type;
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        test_type: form.test_type,
        platform: form.platform.trim(),
        serial: form.serial.trim() || null,
        host: form.host.trim() || null,
        status: form.status,
      };
      // SSH section
      if (sshHost || hasSshAuth || form.ssh_user.trim()) {
        payload.ssh_host = sshHost || null;
        payload.ssh_port = form.ssh_port ? Number(form.ssh_port) : 22;
        payload.ssh_user = form.ssh_user.trim() || null;
        payload.ssh_auth_type = form.ssh_auth_type || null;
        payload.ssh_password = form.ssh_password || null;
        payload.ssh_private_key = form.ssh_private_key || null;
        payload.os_type = form.os_type || 'linux';
      } else if (editing) {
        // Editing and the SSH section was empty — explicit clear so the
        // user can wipe credentials without manually deleting each field.
        payload.ssh_host = null;
        payload.ssh_user = null;
        payload.ssh_auth_type = null;
        payload.ssh_password = null;
        payload.ssh_private_key = null;
      }

      let res;
      if (editing) {
        res = await apiFetch<{ changes: number }>(`/devices/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (res.code === 200) {
          notification.success('设备已更新');
          closeForm();
          fetchDevices();
        } else {
          notification.error(res.message || '更新失败');
        }
      } else {
        res = await apiFetch<{ id: number }>('/devices', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (res.code === 201) {
          notification.success('设备已添加');
          closeForm();
          fetchDevices();
        } else {
          notification.error(res.message || '添加失败');
        }
      }
    } catch (err) {
      notification.error(editing ? '更新失败' : '添加失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (device: DeviceRow) => {
    const ok = await notification.confirm(`确定删除设备「${device.name}」？该操作不可恢复。`);
    if (!ok) return;
    try {
      const res = await apiFetch<{ changes: number }>(`/devices/${device.id}`, { method: 'DELETE' });
      if (res.code === 200) {
        notification.success('设备已删除');
        fetchDevices();
      } else {
        notification.error(res.message || '删除失败');
      }
    } catch {
      notification.error('删除失败');
    }
  };

  const handlePush = async (device: DeviceRow) => {
    // 2026-06-07: SSH config is now validated at click time, not at render
    // time, so the button stays visible for every pushable device. If the user
    // hasn't filled in SSH info yet, nudge them to the edit form instead
    // of silently failing.
    if (!hasSshConfig(device)) {
      notification.warning('该设备尚未配置 SSH 推送信息,请先编辑');
      openEdit(device);
      setShowSshSection(true);
      return;
    }
    // 2026-06-09: 端点按 test_type 选 — web 走 /push-agent,mobile 走
    // /push-mobile-agent,pc 走 /push-pc-agent。Server 端 push.ts 内部按
    // kind 决定 systemd vs launchd,wda vs adb 区别。
    // 2026-06-15: 加入 pc 分支。
    const endpoint = device.test_type === 'mobile' ? 'push-mobile-agent'
      : device.test_type === 'pc' ? 'push-pc-agent'
      : 'push-agent';
    const agentLabel = device.test_type === 'mobile' ? 'mobile-agent'
      : device.test_type === 'pc' ? 'pc-agent'
      : 'web-agent';
    const serviceMgr = device.os_type === 'macos' ? 'launchd' : 'systemd';
    const ok = await notification.confirm(`将向 ${device.ssh_user}@${device.ssh_host} 推送最新 ${agentLabel} 并通过 ${serviceMgr} 启动,可能需要 1-2 分钟。是否继续?`);
    if (!ok) return;
    setPushingId(device.id);
    try {
      const res = await apiFetch<{ version?: string; took_ms?: number; bytes_uploaded?: number; error?: string }>(
        `/devices/${device.id}/${endpoint}`,
        { method: 'POST' }
      );
      if (res.code === 200) {
        notification.success(
          `上线成功: v${res.data?.version} (${(res.data?.bytes_uploaded ?? 0) / 1024 / 1024 | 0}MB, ${((res.data?.took_ms ?? 0) / 1000).toFixed(1)}s)`
        );
        fetchDevices();
      } else {
        notification.error(res.message || res.data?.error || '上线失败');
      }
    } catch {
      notification.error('上线失败,请检查 SSH 凭据/网络');
    } finally {
      setPushingId(null);
    }
  };

  const handleStop = async (device: DeviceRow) => {
    // 2026-06-07: same validation-at-click pattern as handlePush — the
    // stop button is visible for every online pushable device, but we still
    // bail to the edit form if SSH isn't configured.
    if (!hasSshConfig(device)) {
      notification.warning('该设备尚未配置 SSH 推送信息,请先编辑');
      openEdit(device);
      setShowSshSection(true);
      return;
    }
    const endpoint = device.test_type === 'mobile' ? 'stop-mobile-agent'
      : device.test_type === 'pc' ? 'stop-pc-agent'
      : 'stop-agent';
    const stopCmd = device.os_type === 'macos' ? 'launchctl unload' : 'systemctl stop';
    const ok = await notification.confirm(`将通过 SSH 停止 ${device.name} 上的 agent (${stopCmd})。是否继续?`);
    if (!ok) return;
    setStoppingId(device.id);
    try {
      const res = await apiFetch<unknown>(`/devices/${device.id}/${endpoint}`, { method: 'POST' });
      if (res.code === 200) {
        notification.success('已下线');
        fetchDevices();
      } else {
        notification.error(res.message || '下线失败');
      }
    } catch {
      notification.error('下线失败');
    } finally {
      setStoppingId(null);
    }
  };

  const formatDate = (s: string | null) => s ? new Date(s).toLocaleString('zh-CN') : '—';
  const statusInfo = (s: DeviceStatus) => STATUS_OPTIONS.find(x => x.value === s) || STATUS_OPTIONS[2];
  const testTypeLabel = (t: DeviceTestType) => TEST_TYPE_OPTIONS.find(x => x.value === t)?.label || t;
  const hasSshConfig = (d: { ssh_host?: string | null; ssh_user?: string | null; ssh_auth_type?: SshAuthType | null }) =>
    !!(d.ssh_host && d.ssh_user && d.ssh_auth_type);

  return (
    <div className="device-list page-enter">
      <div className="device-list__header">
        <h2>设备库</h2>
        <p className="device-list__desc">管理 Web / PC / 移动端测试所需的设备与浏览器实例</p>
      </div>

      <div className="device-list__toolbar">
        <div className="device-list__filters">
          <FormSelect value={filterType} options={[{ value: '', label: '全部类型' }, ...TEST_TYPE_OPTIONS]} onChange={v => setFilterType(v as DeviceTestType | '')} size="sm" />
          <FormSelect value={filterStatus} options={[{ value: '', label: '全部状态' }, ...STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))]} onChange={v => setFilterStatus(v as DeviceStatus | '')} size="sm" />
          <input
            type="text"
            placeholder="搜索名称 / 序列号 / 地址"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') fetchDevices(); }}
          />
          <button className="device-list__btn device-list__btn--secondary" onClick={fetchDevices}>搜索</button>
        </div>
        <button className="device-list__btn device-list__btn--primary" onClick={openCreate}>+ 添加设备</button>
      </div>

      {loading ? (
        <div className="device-list__loading">加载中...</div>
      ) : devices.length === 0 ? (
        <div className="device-list__empty">暂无设备，点击右上角添加</div>
      ) : (
        <table className="device-list__table">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>平台</th>
              <th>序列号 / UDID</th>
              <th>连接地址</th>
              <th>状态</th>
              <th>最后心跳</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device, index) => {
              const s = statusInfo(device.status);
              const isPushing = pushingId === device.id;
              const isStopping = stoppingId === device.id;
              return (
                <tr key={device.id} className="row-enter" style={{ '--delay': `${index * 30}ms` } as React.CSSProperties}>
                  <td className="device-list__name">
                    {device.name}
                    {device.needs_upgrade === 1 && (
                      <span className="device-list__badge device-list__badge--warn" title='服务器版本已升级,请点击 "升级上线" 推送最新 agent'>需要升级</span>
                    )}
                  </td>
                  <td>{testTypeLabel(device.test_type)}</td>
                  <td><code>{device.platform}</code></td>
                  <td>{device.serial || '—'}</td>
                  <td>{device.host || '—'}</td>
                  <td>
                    <span className={`device-list__status device-list__status--${s.color}`} title={device.last_seen_at ? `Agent 上次心跳: ${formatDate(device.last_seen_at)}` : undefined}>
                      {s.label}
                    </span>
                  </td>
                  <td>{device.last_seen_at ? formatDate(device.last_seen_at) : formatDate(device.last_heartbeat)}</td>
                  <td>{formatDate(device.updated_at)}</td>
                  <td className="device-list__actions">
                    {(device.test_type === 'web' || device.test_type === 'mobile' || device.test_type === 'pc') && (
                      device.status === 'online' ? (
                        <button
                          onClick={() => handleStop(device)}
                          disabled={isPushing || isStopping}
                          className="device-list__btn--online"
                          title={hasSshConfig(device) ? `通过 SSH 停止 agent (${device.os_type === 'macos' ? 'launchctl unload' : 'systemctl stop'})` : '尚未配置 SSH,点击去编辑'}
                        >
                          {isStopping ? '下线中…' : '下线'}
                        </button>
                      ) : (
                        <button
                          onClick={() => handlePush(device)}
                          disabled={isPushing || isStopping}
                          className="device-list__btn--offline"
                          title={hasSshConfig(device) ? `通过 SSH 推送最新 ${device.test_type === 'mobile' ? 'mobile-' : device.test_type === 'pc' ? 'pc-' : ''}agent + 启动 (需要 1-2 分钟)` : '尚未配置 SSH,点击去编辑'}
                        >
                          {isPushing ? '上线中…' : (device.needs_upgrade === 1 ? '升级上线' : '上线')}
                        </button>
                      )
                    )}
                    <button onClick={() => openEdit(device)}>编辑</button>
                    <button className="device-list__btn--danger" onClick={() => handleDelete(device)}>删除</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showForm && (
        <div className="device-list__modal-overlay" onClick={closeForm}>
          <div className="device-list__modal" onClick={e => e.stopPropagation()}>
            <h3>{editing ? '编辑设备' : '添加设备'}</h3>
            <form onSubmit={handleSubmit}>
              <label>
                <span>名称 <em>*</em></span>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="如：Chrome 实验室、Pixel 7 真机"
                />
              </label>
              <label>
                <span>测试类型 <em>*</em></span>
                <FormSelect
                  value={form.test_type}
                  options={TEST_TYPE_OPTIONS}
                  onChange={v => {
                    const t = v as DeviceTestType;
                    const presets = PLATFORM_PRESETS[t];
                    setForm({ ...form, test_type: t, platform: presets[0] });
                  }}
                />
              </label>
              <label>
                <span>平台 <em>*</em></span>
                <input
                  type="text"
                  list="device-platform-list"
                  value={form.platform}
                  onChange={e => setForm({ ...form, platform: e.target.value })}
                />
                <datalist id="device-platform-list">
                  {PLATFORM_PRESETS[form.test_type].map(p => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </label>
              <label>
                <span>序列号 / UDID</span>
                <input
                  type="text"
                  value={form.serial}
                  onChange={e => setForm({ ...form, serial: e.target.value })}
                  placeholder="浏览器实例 id 或设备序列号"
                />
              </label>
              <label>
                <span>连接地址</span>
                <input
                  type="text"
                  value={form.host}
                  onChange={e => setForm({ ...form, host: e.target.value })}
                  placeholder="ADB/WDA 远程地址，如 192.168.1.10:5555"
                />
              </label>
              <label>
                <span>状态</span>
                <FormSelect
                  value={form.status}
                  options={STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))}
                  onChange={v => setForm({ ...form, status: v as DeviceStatus })}
                />
              </label>

              <div className="device-list__ssh-section">
                  <button
                    type="button"
                    className="device-list__ssh-toggle"
                    aria-expanded={showSshSection}
                    onClick={() => setShowSshSection(v => !v)}
                  >
                    <span className={`device-list__ssh-toggle-arrow${showSshSection ? ' device-list__ssh-toggle-arrow--open' : ''}`}>▶</span>
                    SSH 推送配置
                    <span className="device-list__ssh-toggle-badge">{showSshSection ? '已展开' : '可选'}</span>
                  </button>
                  {showSshSection && (
                    <div className="device-list__ssh-body">
                      <p className="device-list__hint">
                        填入 SSH 凭据后,可在列表点击"上线"一键推送最新 agent 并重启服务。
                        支持 Linux(systemd) 和 macOS(launchd) 远程机器。
                      </p>
                      <div className="device-list__ssh-grid">
                        <label>
                          <span>SSH 主机</span>
                          <input
                            type="text"
                            value={form.ssh_host}
                            onChange={e => setForm({ ...form, ssh_host: e.target.value })}
                            placeholder="192.168.1.50"
                          />
                        </label>
                        <label>
                          <span>端口</span>
                          <input
                            type="number"
                            min={1}
                            max={65535}
                            value={form.ssh_port}
                            onChange={e => setForm({ ...form, ssh_port: e.target.value })}
                          />
                        </label>
                        <label>
                          <span>SSH 用户</span>
                          <input
                            type="text"
                            value={form.ssh_user}
                            onChange={e => setForm({ ...form, ssh_user: e.target.value })}
                            placeholder="root 或 sudoer 用户"
                          />
                        </label>
                        <label>
                          <span>认证方式</span>
                          <FormSelect
                            value={form.ssh_auth_type}
                            options={[
                              { value: '', label: '不启用' },
                              { value: 'password', label: '密码' },
                              { value: 'private_key', label: '私钥' },
                            ]}
                            onChange={v => setForm({ ...form, ssh_auth_type: v as SshAuthType | '' })}
                          />
                        </label>
                      </div>
                      {form.ssh_auth_type === 'password' && (
                        <label>
                          <span>SSH 密码 {editing && <em style={{ color: '#9ca3af', fontWeight: 400 }}>(留空保留原密码)</em>}</span>
                          <input
                            type="password"
                            value={form.ssh_password}
                            onChange={e => setForm({ ...form, ssh_password: e.target.value })}
                            placeholder={editing ? '留空保留原值' : '明文密码,服务端加密存储'}
                            autoComplete="new-password"
                          />
                        </label>
                      )}
                      {form.ssh_auth_type === 'private_key' && (
                        <label>
                          <span>SSH 私钥 {editing && <em style={{ color: '#9ca3af', fontWeight: 400 }}>(留空保留原私钥)</em>}</span>
                          <textarea
                            value={form.ssh_private_key}
                            onChange={e => setForm({ ...form, ssh_private_key: e.target.value })}
                            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                            rows={6}
                            spellCheck={false}
                          />
                        </label>
                      )}
                      <label>
                        <span>操作系统类型</span>
                        <FormSelect
                          value={form.os_type}
                          options={[
                            { value: 'linux', label: 'Linux (systemd)' },
                            { value: 'macos', label: 'macOS (launchd)' },
                          ]}
                          onChange={v => setForm({ ...form, os_type: v })}
                        />
                        <small className="device-list__hint">macOS 用于部署 iOS 测试 agent(Mac 上跑 WDA 接真机/模拟器)</small>
                      </label>
                    </div>
                  )}
                </div>

              <div className="device-list__modal-actions">
                <button type="button" onClick={closeForm} disabled={saving}>取消</button>
                <button type="submit" className="device-list__btn--primary" disabled={saving}>
                  {saving ? '保存中...' : (editing ? '保存' : '添加')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
