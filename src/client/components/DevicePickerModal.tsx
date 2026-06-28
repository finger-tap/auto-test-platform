// 2026-06-20: 统一设备选择弹窗 — 支持 web / pc / mobile 三种测试类型
//
// 数据源: GET /api/devices/merged?test_type={web|pc|mobile}
//   - mobile: 先选远程机器，再从机器获取手机列表
//   - web/pc: 远端 agent 设备（source='remote'），带 busy 状态
//
// web/pc 额外显示「本机执行」选项（不选设备，后端在本机跑浏览器/桌面）
// mobile 必须选设备，没有本机选项

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import notification from '../utils/notification';
import './DevicePickerModal.css';

// ── 设备数据类型 ──

export interface PickerDevice {
  id: number | string;
  name: string;
  platform: string;
  status: 'online' | 'offline' | 'unknown';
  busy: boolean;
  source: 'local' | 'remote' | 'both';
  host?: string | null;
  serial?: string | null;
  agent_version?: string | null;
  os_type?: string | null;
  viewerCount?: number;
  previewReleasingAt?: number | null;
  remote_device_id?: number;
  rich_info?: {
    manufacturer: string | null;
    model: string | null;
    os_version: string | null;
    sdk_int: number | null;
    screen_size: { width: number; height: number; density: number } | null;
    imsi: null;
  };
}

interface MobileDeviceFromAgent {
  serial: string;
  platform: 'android' | 'harmony' | 'ios';
  model?: string | null;
  os_version?: string | null;
  status?: string;
}

interface DevicePickerModalProps {
  open: boolean;
  testType: 'web' | 'pc' | 'mobile';
  expectedPlatform?: string;
  onClose: () => void;
  onSelect: (device: PickerDevice) => void;
  onLocalExecute?: () => void;
}

// ── 主组件 ──

export default function DevicePickerModal({
  open,
  testType,
  expectedPlatform,
  onClose,
  onSelect,
  onLocalExecute,
}: DevicePickerModalProps) {
  const [items, setItems] = useState<PickerDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  // mobile 两步选择
  const [mobileStep, setMobileStep] = useState<'select-agent' | 'select-phone'>('select-agent');
  const [selectedAgent, setSelectedAgent] = useState<PickerDevice | null>(null);
  const [mobileDevices, setMobileDevices] = useState<MobileDeviceFromAgent[]>([]);
  const [loadingMobile, setLoadingMobile] = useState(false);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: PickerDevice[] }>(`/devices/merged?test_type=${testType}`);
      if (res.code === 200 && res.data) {
        setItems(res.data.items);
      } else {
        notification.error(res.message || '获取设备列表失败');
        setItems([]);
      }
    } catch (e) {
      notification.error('获取设备列表失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [testType]);

  const fetchMobileDevices = useCallback(async (agentId: number) => {
    setLoadingMobile(true);
    try {
      const res = await apiFetch<MobileDeviceFromAgent[]>(`/devices/${agentId}/mobile-devices`);
      if (res.code === 200 && res.data) {
        setMobileDevices(res.data);
      } else {
        notification.error(res.message || '获取手机列表失败');
        setMobileDevices([]);
      }
    } catch (e) {
      notification.error('获取手机列表失败');
      setMobileDevices([]);
    } finally {
      setLoadingMobile(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setKeyword('');
      setMobileStep('select-agent');
      setSelectedAgent(null);
      setMobileDevices([]);
      fetchDevices();
    }
  }, [open, fetchDevices]);

  const handleSelectAgent = (device: PickerDevice) => {
    setSelectedAgent(device);
    setMobileStep('select-phone');
    if (typeof device.id === 'number') {
      fetchMobileDevices(device.id);
    }
  };

  const handleSelectMobileDevice = (mobile: MobileDeviceFromAgent) => {
    if (!selectedAgent) return;
    onSelect({
      ...selectedAgent,
      serial: mobile.serial,
      platform: mobile.platform,
      rich_info: {
        manufacturer: null,
        model: mobile.model || null,
        os_version: mobile.os_version || null,
        sdk_int: null,
        screen_size: null,
        imsi: null,
      },
    });
  };

  const handleBack = () => {
    setMobileStep('select-agent');
    setSelectedAgent(null);
    setMobileDevices([]);
  };

  if (!open) return null;

  const showLocalOption = (testType === 'web' || testType === 'pc') && onLocalExecute;

  const filtered = items.filter((d) => {
    // mobile 类型只显示远程机器（有 agent_endpoint 的），不显示本地设备
    if (testType === 'mobile' && d.source !== 'remote') return false;
    if (testType === 'mobile' && expectedPlatform && d.platform !== expectedPlatform) return false;
    if (!keyword) return true;
    const kw = keyword.toLowerCase();
    return d.name.toLowerCase().includes(kw) || (d.serial || '').toLowerCase().includes(kw) || (d.host || '').toLowerCase().includes(kw);
  });

  // mobile 两步选择
  if (testType === 'mobile') {
    return (
      <div className="dpm-mask" onClick={onClose}>
        <div className="dpm-modal" onClick={e => e.stopPropagation()}>
          <div className="dpm-header">
            <span className="dpm-title">{mobileStep === 'select-agent' ? '选择远程机器' : '选择手机设备'}</span>
            {mobileStep === 'select-phone' && (
              <button className="dpm-cancel" onClick={handleBack} style={{ marginRight: 8 }}>← 返回</button>
            )}
            <button className="dpm-close" onClick={onClose}>✕</button>
          </div>

          {mobileStep === 'select-agent' ? (
            <>
              <div className="dpm-toolbar">
                <input className="dpm-search" placeholder="搜索设备名称 / 地址" value={keyword} onChange={e => setKeyword(e.target.value)} autoFocus />
                <button className="dpm-refresh" onClick={fetchDevices} disabled={loading}>刷新</button>
              </div>
              <div className="dpm-body">
                {loading ? (
                  <div className="dpm-empty">加载中...</div>
                ) : filtered.length === 0 ? (
                  <div className="dpm-empty">无可用的远程机器</div>
                ) : (
                  <table className="dpm-table">
                    <thead><tr><th>设备名称</th><th>系统</th><th>地址</th><th>状态</th><th>操作</th></tr></thead>
                    <tbody>
                      {filtered.map(d => (
                        <tr key={d.id} className={`dpm-row ${d.status === 'offline' ? 'dpm-row-disabled' : ''}`}>
                          <td className="dpm-name">{d.name}</td>
                          <td>{d.os_type || '—'}</td>
                          <td className="dpm-meta">{d.host || '—'}</td>
                          <td><span className={`dpm-status dpm-status-${d.status === 'online' ? 'idle' : 'offline'}`}>● {d.status === 'online' ? '在线' : '离线'}</span></td>
                          <td><button className="dpm-pick" disabled={d.status === 'offline'} onClick={() => handleSelectAgent(d)}>选择</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            <div className="dpm-body">
              {loadingMobile ? (
                <div className="dpm-empty">正在获取手机列表...</div>
              ) : mobileDevices.length === 0 ? (
                <div className="dpm-empty">
                  未发现已连接的手机设备
                  <div style={{ fontSize: 12, color: 'var(--fg-tertiary)', marginTop: 8 }}>
                    请确保远程机器已通过 USB 或 adb connect 连接手机
                  </div>
                </div>
              ) : (
                <table className="dpm-table">
                  <thead><tr><th>设备</th><th>平台</th><th>系统版本</th><th>序列号</th><th>操作</th></tr></thead>
                  <tbody>
                    {mobileDevices.map(dev => (
                      <tr key={dev.serial} className="dpm-row" onClick={() => handleSelectMobileDevice(dev)}>
                        <td className="dpm-name">{dev.platform === 'android' ? '🤖' : dev.platform === 'harmony' ? '🔷' : '📱'} {dev.model || '未知设备'}</td>
                        <td>{dev.platform === 'android' ? 'Android' : dev.platform === 'harmony' ? 'HarmonyOS' : 'iOS'}</td>
                        <td>{dev.os_version || '—'}</td>
                        <td className="dpm-meta">{dev.serial}</td>
                        <td><button className="dpm-pick">选择</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="dpm-footer">
            <span className="dpm-hint">{mobileStep === 'select-agent' ? '选择一台已连接手机的远程机器' : '选择要执行测试的手机'}</span>
            <button className="dpm-cancel" onClick={onClose}>取消</button>
          </div>
        </div>
      </div>
    );
  }

  // web/pc 选择
  return (
    <div className="dpm-mask" onClick={onClose}>
      <div className="dpm-modal" onClick={e => e.stopPropagation()}>
        <div className="dpm-header">
          <span className="dpm-title">{testType === 'web' ? '选择 Web 执行设备' : '选择 PC 执行设备'}</span>
          <button className="dpm-close" onClick={onClose}>✕</button>
        </div>

        <div className="dpm-toolbar">
          <input className="dpm-search" placeholder="搜索设备名称 / 序列号 / 地址" value={keyword} onChange={e => setKeyword(e.target.value)} autoFocus />
          <button className="dpm-refresh" onClick={fetchDevices} disabled={loading}>刷新</button>
        </div>

        <div className="dpm-body">
          {loading ? (
            <div className="dpm-empty">加载中...</div>
          ) : filtered.length === 0 && !showLocalOption ? (
            <div className="dpm-empty">无可用设备</div>
          ) : (
            <table className="dpm-table">
              <thead><tr><th>设备名称</th><th>来源</th><th>系统</th><th>地址</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                {showLocalOption && (
                  <tr className="dpm-row dpm-row-local" onClick={onLocalExecute}>
                    <td className="dpm-name">💻 本机执行</td>
                    <td>本地</td>
                    <td colSpan={3}>在服务器本机运行浏览器</td>
                    <td><button className="dpm-pick">选择</button></td>
                  </tr>
                )}
                {filtered.map(d => (
                  <tr key={d.id} className={`dpm-row ${d.busy || d.status === 'offline' ? 'dpm-row-disabled' : ''}`} onClick={() => !d.busy && d.status !== 'offline' && onSelect(d)}>
                    <td className="dpm-name">{d.name}</td>
                    <td><span className={`dpm-source dpm-source-${d.source}`}>{d.source === 'remote' ? '远端' : d.source === 'local' ? '本地' : '本地+远端'}</span></td>
                    <td>{d.os_type || '—'}</td>
                    <td className="dpm-meta">{d.host || '—'}</td>
                    <td>
                      {d.busy ? <span className="dpm-status dpm-status-busy">● 占用中</span>
                        : d.status === 'offline' ? <span className="dpm-status dpm-status-offline">● 离线</span>
                        : <span className="dpm-status dpm-status-idle">● 空闲</span>}
                    </td>
                    <td><button className="dpm-pick" disabled={d.busy || d.status === 'offline'}>选择</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="dpm-footer">
          <span className="dpm-hint">选择一台在线且空闲的设备</span>
          <button className="dpm-cancel" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
