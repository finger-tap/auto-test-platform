// 2026-06-28: 手机设备选择弹窗
//
// 用于 mobile 测试执行时，从远程 agent 获取手机列表，让用户选择。
// 数据源: GET /api/devices/:id/mobile-devices

import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import './DevicePickerModal.css';

interface MobileDevice {
  serial: string;
  platform: 'android' | 'harmony' | 'ios';
  model?: string | null;
  os_version?: string | null;
  status?: string;
}

interface MobileDevicePickerProps {
  open: boolean;
  deviceId: number;
  deviceName: string;
  onClose: () => void;
  onSelect: (device: MobileDevice) => void;
}

export default function MobileDevicePicker({ open, deviceId, deviceName, onClose, onSelect }: MobileDevicePickerProps) {
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    apiFetch<MobileDevice[]>(`/devices/${deviceId}/mobile-devices`)
      .then(res => {
        if (res.code === 200 && res.data) {
          setDevices(res.data);
        } else {
          setError(res.message || '获取设备列表失败');
        }
      })
      .catch(e => {
        setError(e instanceof Error ? e.message : '请求失败');
      })
      .finally(() => setLoading(false));
  }, [open, deviceId]);

  if (!open) return null;

  const platformLabel = (p: string) => {
    if (p === 'android') return 'Android';
    if (p === 'harmony') return 'HarmonyOS';
    if (p === 'ios') return 'iOS';
    return p;
  };

  return (
    <div className="device-picker-overlay" onClick={onClose}>
      <div className="device-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="device-picker-header">
          <h3>选择手机设备</h3>
          <span className="device-picker-subtitle">来自 {deviceName}</span>
          <button className="device-picker-close" onClick={onClose}>✕</button>
        </div>

        <div className="device-picker-body">
          {loading ? (
            <div className="device-picker-empty">正在获取设备列表...</div>
          ) : error ? (
            <div className="device-picker-empty device-picker-error">{error}</div>
          ) : devices.length === 0 ? (
            <div className="device-picker-empty">未发现已连接的手机设备</div>
          ) : (
            <div className="device-picker-list">
              {devices.map(dev => (
                <div
                  key={dev.serial}
                  className="device-picker-item"
                  onClick={() => onSelect(dev)}
                >
                  <div className="device-picker-item-icon">
                    {dev.platform === 'android' ? '🤖' : dev.platform === 'harmony' ? '🔷' : '📱'}
                  </div>
                  <div className="device-picker-item-info">
                    <div className="device-picker-item-name">
                      {dev.model || dev.serial}
                    </div>
                    <div className="device-picker-item-meta">
                      <span>{platformLabel(dev.platform)}</span>
                      {dev.os_version && <span> · {dev.os_version}</span>}
                      <span> · {dev.serial}</span>
                    </div>
                  </div>
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
