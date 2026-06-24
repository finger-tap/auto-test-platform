// 2026-06-20: 统一设备选择弹窗 — 支持 web / pc / mobile 三种测试类型
//
// 数据源: GET /api/devices/merged?test_type={web|pc|mobile}
//   - mobile: 本地 adb/hdc/iOS + 远端 agent 设备，source 区分来源
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

  useEffect(() => {
    if (open) {
      setKeyword('');
      fetchDevices();
    }
  }, [open, fetchDevices]);

  if (!open) return null;

  const showLocalOption = testType === 'web' || testType === 'pc';
  const title = TEST_TYPE_TITLE[testType] || '选择执行设备';

  // 过滤：mobile 按 expectedPlatform，所有类型按 keyword 搜索
  const filtered = items.filter((d) => {
    if (testType === 'mobile' && expectedPlatform && d.platform !== expectedPlatform) {
      return false;
    }
    if (!keyword) return true;
    const k = keyword.toLowerCase();
    return (
      d.name.toLowerCase().includes(k) ||
      (d.serial || '').toLowerCase().includes(k) ||
      (d.host || '').toLowerCase().includes(k) ||
      (d.platform || '').toLowerCase().includes(k)
    );
  });

  // 判断设备是否可选（空闲 + 在线）
  const isPickable = (d: PickerDevice) => !d.busy && d.status === 'online';

  // 设备详情行：web/pc 显示 platform + host + agent_version；mobile 显示 rich_info
  const renderMeta = (d: PickerDevice) => {
    if (testType === 'mobile' && d.rich_info) {
      const ri = d.rich_info;
      const parts = [
        ri.manufacturer || '未知厂商',
        d.serial,
        d.host ? `@${d.host}` : '',
      ].filter(Boolean);
      return (
        <>
          <div className="dpm-meta">{parts.join(' · ')}</div>
          {ri.os_version && (
            <div className="dpm-meta">{ri.os_version}{ri.sdk_int != null ? ` (SDK ${ri.sdk_int})` : ''}</div>
          )}
          {ri.screen_size && (
            <div className="dpm-meta">{ri.screen_size.width}×{ri.screen_size.height} @{ri.screen_size.density}dpi</div>
          )}
        </>
      );
    }
    // web/pc: 扁平字段
    const parts = [d.platform, d.host, d.serial].filter(Boolean);
    return (
      <>
        <div className="dpm-meta">{parts.join(' · ') || '—'}</div>
        {d.agent_version && <div className="dpm-meta">agent v{d.agent_version}</div>}
      </>
    );
  };

  // web/pc 不需要「来源」列（全是 remote）；mobile 需要
  const showSourceColumn = testType === 'mobile';

  return (
    <div className="dpm-mask" onClick={onClose}>
      <div className="dpm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dpm-header">
          <div className="dpm-title">{title}</div>
          <button className="dpm-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="dpm-toolbar">
          <input
            className="dpm-search"
            placeholder="搜索设备名 / host / serial / 平台"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <button className="dpm-refresh" onClick={fetchDevices} disabled={loading}>
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>

        <div className="dpm-body">
          {loading && items.length === 0 ? (
            <div className="dpm-empty">加载中...</div>
          ) : (
            <table className="dpm-table">
              <thead>
                <tr>
                  <th>设备</th>
                  {testType === 'mobile' && <th>系统</th>}
                  {testType === 'mobile' && <th>屏幕</th>}
                  {showSourceColumn && <th>来源</th>}
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {/* web/pc: 本机执行选项 */}
                {showLocalOption && onLocalExecute && (
                  <tr className="dpm-row dpm-row-local" onClick={onLocalExecute}>
                    <td>
                      <div className="dpm-name">💻 本机执行</div>
                      <div className="dpm-meta">在当前服务器本地运行{testType === 'web' ? '浏览器' : '桌面自动化'}</div>
                    </td>
                    {showSourceColumn && <td></td>}
                    <td>
                      <span className="dpm-status dpm-status-idle">● 可用</span>
                    </td>
                    <td>
                      <button
                        className="dpm-pick"
                        onClick={(e) => { e.stopPropagation(); onLocalExecute(); }}
                      >
                        执行
                      </button>
                    </td>
                  </tr>
                )}

                {/* 远程设备列表 */}
                {filtered.length === 0 && !showLocalOption ? (
                  <tr>
                    <td colSpan={showSourceColumn ? 6 : 4} className="dpm-empty">
                      {items.length === 0
                        ? '未发现设备，请确认远端 agent 已启动并上报心跳'
                        : '没有匹配当前筛选条件的设备'}
                    </td>
                  </tr>
                ) : filtered.length === 0 && showLocalOption ? (
                  <tr>
                    <td colSpan={showSourceColumn ? 5 : 3} className="dpm-empty-cell">
                      没有匹配的远程设备（仍可选择本机执行）
                    </td>
                  </tr>
                ) : (
                  filtered.map((d) => {
                    const pickable = isPickable(d);
                    return (
                      <tr
                        key={d.id}
                        className={`dpm-row${pickable ? '' : ' dpm-row-disabled'}`}
                        onClick={() => pickable && onSelect(d)}
                      >
                        <td>
                          <div className="dpm-name">{d.name}</div>
                          {renderMeta(d)}
                        </td>
                        {testType === 'mobile' && (
                          <td>
                            <div>{d.rich_info?.os_version || '—'}</div>
                            {d.rich_info?.sdk_int != null && (
                              <div className="dpm-meta">SDK {d.rich_info.sdk_int}</div>
                            )}
                          </td>
                        )}
                        {testType === 'mobile' && (
                          <td>
                            {d.rich_info?.screen_size
                              ? `${d.rich_info.screen_size.width}×${d.rich_info.screen_size.height} @${d.rich_info.screen_size.density || '?'}dpi`
                              : '—'}
                          </td>
                        )}
                        {showSourceColumn && (
                          <td>
                            <span className={`dpm-source dpm-source-${d.source}`}>
                              {SOURCE_LABEL[d.source] || d.source}
                            </span>
                          </td>
                        )}
                        <td>
                          <StatusBadge device={d} />
                        </td>
                        <td>
                          <button
                            className="dpm-pick"
                            disabled={!pickable}
                            onClick={(e) => { e.stopPropagation(); if (pickable) onSelect(d); }}
                          >
                            选用
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="dpm-footer">
          <span className="dpm-hint">
            {testType === 'mobile'
              ? 'IMSI 永远显示 "需 ROOT 权限"（server 端 adb/hdc 无权读取）'
              : '仅显示已注册且 agent 在线的远程设备'}
          </span>
          <button className="dpm-cancel" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
