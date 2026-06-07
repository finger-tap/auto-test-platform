import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../utils/api';
import notification from '../../utils/notification';
import './WebBrowserConfig.css';

interface ServerRow {
  driver_path: string | null;
  user_data_dir: string | null;
  accept_downloads: 0 | 1;
  download_dir: string | null;
  auto_download: 0 | 1;
  executable_path: string | null;
  chromium_sandbox: 0 | 1;
  close_browser_after_execution: 0 | 1;
  default_timeout_ms: number | null;
}

interface FormState {
  driver_path: string;
  user_data_dir: string;
  accept_downloads: boolean;
  download_dir: string;
  auto_download: boolean;
  executable_path: string;
  chromium_sandbox: boolean;
  close_browser_after_execution: boolean;
  default_timeout_ms: string; // UI keeps as string for the number input
}

const INITIAL: FormState = {
  driver_path: '',
  user_data_dir: '',
  accept_downloads: true,
  download_dir: '',
  auto_download: false,
  executable_path: '',
  chromium_sandbox: false,
  close_browser_after_execution: false,
  default_timeout_ms: '',
};

const formFromRow = (row: ServerRow | null): FormState => ({
  driver_path: row?.driver_path ?? '',
  user_data_dir: row?.user_data_dir ?? '',
  accept_downloads: row?.accept_downloads === 1,
  download_dir: row?.download_dir ?? '',
  auto_download: row?.auto_download === 1,
  executable_path: row?.executable_path ?? '',
  chromium_sandbox: row?.chromium_sandbox === 1,
  close_browser_after_execution: row?.close_browser_after_execution === 1,
  default_timeout_ms: row?.default_timeout_ms != null ? String(row.default_timeout_ms) : '',
});

const payloadFromForm = (f: FormState) => ({
  driver_path: f.driver_path.trim() || null,
  user_data_dir: f.user_data_dir.trim() || null,
  accept_downloads: f.accept_downloads,
  download_dir: f.download_dir.trim() || null,
  auto_download: f.auto_download,
  executable_path: f.executable_path.trim() || null,
  chromium_sandbox: f.chromium_sandbox,
  close_browser_after_execution: f.close_browser_after_execution,
  default_timeout_ms: f.default_timeout_ms.trim() === '' ? null : Number(f.default_timeout_ms),
});

export default function WebBrowserConfig() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(() => {
    apiFetch<ServerRow | null>('/web-browser-config').then(res => {
      setForm(formFromRow(res.data ?? null));
      setLoaded(true);
    }).catch(() => {
      setForm(INITIAL);
      setLoaded(true);
    });
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<ServerRow>('/web-browser-config', {
        method: 'PUT',
        body: JSON.stringify(payloadFromForm(form)),
      });
      if (res.code === 200) {
        notification.success('浏览器配置已保存,下次执行生效');
        setForm(formFromRow(res.data ?? null));
      } else {
        notification.error(res.message || '保存失败');
      }
    } catch (e) {
      notification.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (confirm('确认放弃未保存的修改并重新加载当前配置？')) {
      fetchConfig();
    }
  };

  if (!loaded) {
    return (
      <div className="sys-root">
        <div className="sys-head"><h2>Web 浏览器配置</h2></div>
        <div className="sys-card">加载中...</div>
      </div>
    );
  }

  return (
    <div className="sys-root">
      <div className="sys-head">
        <h2>Web 浏览器配置</h2>
        <div className="wbc-head-desc">
          配置 Web 测试用的 Playwright 浏览器行为。这些设置是<strong>用户级</strong>的,
          适用于本用户的所有 Web 用例,保存后下一次执行即生效,无需重启服务。
        </div>
      </div>

      {/* 启动选项 */}
      <div className="sys-card">
        <div className="sys-card-title">启动选项</div>
        <div className="sys-card-desc">浏览器二进制、驱动路径、沙箱控制</div>

        <div className="wbc-grid">
          <label className="wbc-field wbc-field-full">
            <span className="wbc-label">驱动路径 (driver_path)</span>
            <input
              className="wbc-input"
              type="text"
              placeholder="留空走默认驱动(项目自带的 ./drivers);填绝对路径则用指定驱动"
              value={form.driver_path}
              onChange={e => update('driver_path', e.target.value)}
            />
            <span className="wbc-hint">对应 Playwright 的 <code>PLAYWRIGHT_BROWSERS_PATH</code> 环境变量</span>
          </label>

          <label className="wbc-field wbc-field-full">
            <span className="wbc-label">可执行文件路径 (executable_path)</span>
            <input
              className="wbc-input"
              type="text"
              placeholder="例如 /opt/chrome/chrome  留空用 Playwright 捆绑的浏览器"
              value={form.executable_path}
              onChange={e => update('executable_path', e.target.value)}
            />
            <span className="wbc-hint">直接指定 chromium 二进制路径(覆盖 driver_path)</span>
          </label>

          <label className="wbc-field wbc-toggle-field">
            <span className="wbc-label">关闭 Chromium 沙箱 (chromium_sandbox)</span>
            <button
              type="button"
              className={`wbc-switch ${form.chromium_sandbox ? 'on' : ''}`}
              onClick={() => update('chromium_sandbox', !form.chromium_sandbox)}
              aria-pressed={form.chromium_sandbox}
            >
              <span className="wbc-switch-knob" />
            </button>
            <span className="wbc-hint">Docker / 容器环境请保持关闭,默认 OFF</span>
          </label>
        </div>
      </div>

      {/* 上下文选项 */}
      <div className="sys-card">
        <div className="sys-card-title">浏览器上下文</div>
        <div className="sys-card-desc">影响每个用例的新 BrowserContext</div>

        <div className="wbc-grid">
          <label className="wbc-field wbc-field-full">
            <span className="wbc-label">用户数据目录 (user_data_dir)</span>
            <input
              className="wbc-input"
              type="text"
              placeholder="例如 /home/me/.midscene-profile  留空则每次启动隔离"
              value={form.user_data_dir}
              onChange={e => update('user_data_dir', e.target.value)}
            />
            <span className="wbc-hint">登录态 / Cookie / localStorage 在用例间持久化</span>
          </label>

          <label className="wbc-toggle-field">
            <span className="wbc-label">接受下载 (accept_downloads)</span>
            <button
              type="button"
              className={`wbc-switch ${form.accept_downloads ? 'on' : ''}`}
              onClick={() => update('accept_downloads', !form.accept_downloads)}
              aria-pressed={form.accept_downloads}
            >
              <span className="wbc-switch-knob" />
            </button>
            <span className="wbc-hint">关闭后下载事件会抛错,适合禁止文件落盘的环境</span>
          </label>

          <label className="wbc-field wbc-field-full">
            <span className="wbc-label">下载目录 (download_dir)</span>
            <input
              className="wbc-input"
              type="text"
              placeholder="例如 /tmp/midscene-dl  留空则下载到系统临时目录"
              value={form.download_dir}
              onChange={e => update('download_dir', e.target.value)}
            />
          </label>

          <label className="wbc-toggle-field">
            <span className="wbc-label">自动下载 (auto_download)</span>
            <button
              type="button"
              className={`wbc-switch ${form.auto_download ? 'on' : ''}`}
              onClick={() => update('auto_download', !form.auto_download)}
              aria-pressed={form.auto_download}
            >
              <span className="wbc-switch-knob" />
            </button>
            <span className="wbc-hint">开启后每次 download 事件自动 saveAs 到 download_dir(需同时打开接受下载)</span>
          </label>
        </div>
      </div>

      {/* 执行行为 */}
      <div className="sys-card">
        <div className="sys-card-title">执行行为</div>
        <div className="sys-card-desc">控制用例结束后的浏览器生命周期与超时</div>

        <div className="wbc-grid">
          <label className="wbc-toggle-field">
            <span className="wbc-label">执行后关闭浏览器</span>
            <button
              type="button"
              className={`wbc-switch ${form.close_browser_after_execution ? 'on' : ''}`}
              onClick={() => update('close_browser_after_execution', !form.close_browser_after_execution)}
              aria-pressed={form.close_browser_after_execution}
            >
              <span className="wbc-switch-knob" />
            </button>
            <span className="wbc-hint">关闭:本用户所有 Web 用例每次执行完都关闭浏览器;OFF:浏览器复用,首用例会有 ~2-3s 冷启动开销</span>
          </label>

          <label className="wbc-field">
            <span className="wbc-label">默认超时 (ms)</span>
            <input
              className="wbc-input"
              type="number"
              min={0}
              placeholder="例如 60000"
              value={form.default_timeout_ms}
              onChange={e => update('default_timeout_ms', e.target.value)}
            />
            <span className="wbc-hint">影响 setDefaultTimeout + setDefaultNavigationTimeout,留空用 Playwright 默认(30s)</span>
          </label>
        </div>
      </div>

      <div className="wbc-actions">
        <button className="wbc-btn-secondary" onClick={handleReset} disabled={saving}>放弃修改</button>
        <button className="wbc-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>

      <div className="wbc-footnote">
        <div className="wbc-footnote-title">使用提示</div>
        <ul>
          <li>本配置是<strong>用户级</strong>的,影响本用户所有 Web 用例。</li>
          <li>浏览器复用:同配置下多个用例共享一个 Chromium 进程,每个用例独立 BrowserContext(cookie/storage 隔离)。</li>
          <li>切换 driver_path / executable_path / chromium_sandbox 会自动关闭并重建共享浏览器,约 2-3s。</li>
        </ul>
      </div>
    </div>
  );
}
