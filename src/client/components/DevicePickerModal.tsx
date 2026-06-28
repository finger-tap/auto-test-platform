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

// ── 设备数据类型（兼容 web/pc 的扁平结构和 mobile 的 rich_info 结构）──

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
  /** 测试类型，决定数据源和是否显示「本机执行」 */
  testType: 'web' | 'pc' | 'mobile';
  /** mobile 专用：按平台过滤（android/ios/harmony） */
  expectedPlatform?: string;
  onClose: () => void;
  /** 选中远程设备 */
  onSelect: (device: PickerDevice) => void;
  /** web/pc 专用：用户选择本机执行（不传 deviceId） */
  onLocalExecute?: () => void;
}

// ── 标签映射 ──

const SOURCE_LABEL: Record<string, string> = {
  local: '本地',
  remote: '远端',
  both: '本地+远端',
};

const STATUS_LABEL: Record<string, string> = {
  online: '在线',
  offline: '离线',
  unknown: '未知',
};

const TEST_TYPE_TITLE: Record<string, string> = {
  web: '选择 Web 执行设备',
  pc: '选择 PC 执行设备',
  mobile: '选择移动设备',
};

// ── 状态 badge ──

function StatusBadge({ device }: { device: PickerDevice }) {
  if (device.busy) {
    return <span className="dpm-status dpm-status-busy">● 占用中</span>;
  }
  if ((device.viewerCount ?? 0) > 0) {
    return (
      <span className="dpm-status dpm-status-watching">
        ● {device.viewerCount} 人观看
      </span>
    );
  }
  if (device.status === 'offline') {
    return <span className="dpm-status dpm-status-offline">● 离线</span>;
  }
  return <span className="dpm-status dpm-status-idle">● 空闲</span>;
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

  // mobile 两步选择：step1=选机器，step2=选手机
  const [mobileStep, setMobileStep] = useState<'select-agent' | 'select-phone'>('select-agent');
  const [selectedAgent, setSelectedAgent] = useState<PickerDevice | null>(null);
  const [mobileDevices, setMobileDevices] = useState<MobileDeviceFromAgent[]>([]);
  const [loadingMobile, setLoadingMobile] = useState(false);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: PickerDevice[] }>(
        `/devices/merged?test_type=${testType}`
      );
      if (res.code === 200 && res.data) {
        setItems(res.data.items);
      } else {
        notification.error(res.message || '获取设备列表失败');
        setItems([]);
      }
    } catch (e) {
      console.error(`[device-picker] fetch failed: ${e instanceof Error ? e.message : String(e)}`);
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
      console.error(`[device-picker] fetch mobile devices failed: ${e instanceof Error ? e.message : String(e)}`);
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
    // 返回一个 PickerDevice，包含 agent 信息和手机 serial
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

  const showLocalOption = testType === 'web' || testType === 'pc';
  const title = TEST_TYPE_TITLE[testType] || '选择执行设备';

  // 过滤：mobile 按 expectedPlatform，所有类型按 keyword 搜索
  const filtered = items.filter((d) => {
    if (testType === 'mobile' && expectedPlatform && d.platform !== expectedPlatform) {
      return false;
    }
    if (!keyword) return true;
    const kw = keyword.toLowerCase();
    return (
      d.name.toLowerCase().includes(kw) ||
      (d.serial || '').toLowerCase().includes(kw) ||
      (d.host || '').toLowerCase().includes(kw)
    );
  });

  // mobile 两步选择
  if (testType === 'mobile') {
    return (
      <div className="device-picker-overlay" onClick={onClose}>
        <div className="device-picker-modal" onClick={e => e.stopPropagation()}>
          <div className="device-picker-header">
            <h3>{mobileStep === 'select-agent' ? '选择远程机器' : '选择手机设备'}</h3>
            {mobileStep === 'select-phone' && selectedAgent && (
              <button className="device-picker-back" onClick={handleBack}>← 返回</button>
            )}
            <button className="device-picker-close" onClick={onClose}>✕</button>
          </div>

          {mobileStep === 'select-agent' ? (
            <>
              <div className="device-picker-search">
                <input
                  type="text"
                  placeholder="搜索设备名称 / 地址"
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="device-picker-body">
                {loading ? (
                  <div className="device-picker-empty">加载中...</div>
                ) : filtered.length === 0 ? (
                  <div className="device-picker-empty">无可用的远程机器</div>
                ) : (
                  <div className="device-picker-list">
                    {filtered.map(d => (
                      <div
                        key={d.id}
                        className={`device-picker-item ${d.status === 'offline' ? 'device-picker-item--disabled' : ''}`}
                        onClick={() => d.status !== 'offline' && handleSelectAgent(d)}
                      >
                        <div className="device-picker-item-info">
                          <div className="device-picker-item-name">{d.name}</div>
                          <div className="device-picker-item-meta">
                            {d.os_type && <span>{d.os_type}</span>}
                            {d.host && <span> · {d.host}</span>}
                            {d.agent_version && <span> · v{d.agent_version}</span>}
                          </div>
                        </div>
                        <StatusBadge device={d} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="device-picker-body">
              {loadingMobile ? (
                <div className="device-picker-empty">正在获取手机列表...</div>
              ) : mobileDevices.length === 0 ? (
                <div className="device-picker-empty">
                  未发现已连接的手机设备
                  <div style={{ fontSize: 12, color: 'var(--fg-tertiary)', marginTop: 8 }}>
                    请确保远程机器已通过 USB 或 adb connect 连接手机
                  </div>
                </div>
              ) : (
                <div className="device-picker-list">
                  {mobileDevices.map(dev => (
                    <div
                      key={dev.serial}
                      className="device-picker-item"
                      onClick={() => handleSelectMobileDevice(dev)}
                    >
                      <div className="device-picker-item-icon">
                        {dev.platform === 'android' ? '🤖' : dev.platform === 'harmony' ? '🔷' : '📱'}
                      </div>
                      <div className="device-picker-item-info">
                        <div className="device-picker-item-name">
                          {dev.model || dev.serial}
                        </div>
                        <div className="device-picker-item-meta">
                          <span>{dev.platform === 'android' ? 'Android' : dev.platform === 'harmony' ? 'HarmonyOS' : 'iOS'}</span>
                          {dev.os_version && <span> · {dev.os_version}</span>}
                          <span> · {dev.serial}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="device-picker-footer">
            <button className="scenario-btn" onClick={onClose}>取消</button>
          </div>
        </div>
      </div>
    );
  }

  // web/pc 选择
  return (
    <div className="device-picker-overlay" onClick={onClose}>
      <div className="device-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="device-picker-header">
          <h3>{title}</h3>
          <button className="device-picker-close" onClick={onClose}>✕</button>
        </div>

        <div className="device-picker-search">
          <input
            type="text"
            placeholder="搜索设备名称 / 序列号 / 地址"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            autoFocus
          />
        </div>

        <div className="device-picker-body">
          {loading ? (
            <div className="device-picker-empty">加载中...</div>
          ) : filtered.length === 0 && !showLocalOption ? (
            <div className="device-picker-empty">无可用设备</div>
          ) : (
            <div className="device-picker-list">
              {showLocalOption && (
                <div className="device-picker-item device-picker-item--local" onClick={onLocalExecute}>
                  <div className="device-picker-item-info">
                    <div className="device-picker-item-name">💻 本机执行</div>
                    <div className="device-picker-item-meta">在服务器本机运行浏览器</div>
                  </div>
                </div>
              )}
              {filtered.map(d => (
                <div
                  key={d.id}
                  className={`device-picker-item ${d.busy || d.status === 'offline' ? 'device-picker-item--disabled' : ''}`}
                  onClick={() => !d.busy && d.status !== 'offline' && onSelect(d)}
                >
                  <div className="device-picker-item-info">
                    <div className="device-picker-item-name">{d.name}</div>
                    <div className="device-picker-item-meta">
                      {d.source && <span>{SOURCE_LABEL[d.source]}</span>}
                      {d.os_type && <span> · {d.os_type}</span>}
                      {d.host && <span> · {d.host}</span>}
                      {d.agent_version && <span> · v{d.agent_version}</span>}
                    </div>
                  </div>
                  <StatusBadge device={d} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="device-picker-footer">
          <button className="scenario-btn" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
