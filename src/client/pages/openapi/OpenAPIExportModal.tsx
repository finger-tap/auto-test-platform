import { useState } from 'react';
import { apiFetch, apiFetchBlob } from '../../utils/api';

interface Props {
  /** 当前列表页已勾选的API ID 数组 */
  selectedIds?: number[];
  onExported?: () => void;
}

export default function OpenAPIExportModal({ selectedIds = [], onExported }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('API Export');
  const [version, setVersion] = useState('1.0.0');
  const [baseUrl, setBaseUrl] = useState('');
  const [format, setFormat] = useState<'openapi' | 'postman'>('openapi');
  const [exporting, setExporting] = useState(false);

  const openModal = () => {
    setOpen(true);
    setTitle('API Export');
    setVersion('1.0.0');
    setBaseUrl('');
    setFormat('openapi');
  };

  const closeModal = () => setOpen(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        format,
        title,
        version,
      });
      if (baseUrl) params.set('baseUrl', baseUrl);
      if (selectedIds.length > 0) params.set('ids', selectedIds.join(','));

      const res = await apiFetchBlob(`/openapi/export?${params.toString()}`);
      const blob = await res.blob();
      const filename = `${title}.${format === 'openapi' ? 'openapi.json' : 'postman_collection.json'}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      closeModal();
      onExported?.();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  if (!open) {
    return (
      <button className="ad-btn ad-btn-sm" onClick={openModal} style={{ marginLeft: 8 }}>
        📤 导出
      </button>
    );
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal-content export-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>导出接口</h3>
          <button className="modal-close" onClick={closeModal}>✕</button>
        </div>

        <div className="modal-body">
          <div className="export-format-group">
            <label>导出格式</label>
            <div className="format-cards">
              <div
                className={`format-card ${format === 'openapi' ? 'active' : ''}`}
                onClick={() => setFormat('openapi')}
              >
                <div className="format-icon">📄</div>
                <div className="format-name">OpenAPI 3.0</div>
                <div className="format-desc">兼容 Swagger / Apifox / Apipost</div>
              </div>
              <div
                className={`format-card ${format === 'postman' ? 'active' : ''}`}
                onClick={() => setFormat('postman')}
              >
                <div className="format-icon">📬</div>
                <div className="format-name">Postman Collection</div>
                <div className="format-desc">导入到 Postman / Insomnia</div>
              </div>
            </div>
          </div>

          <div className="export-field">
            <label>文档标题</label>
            <input
              className="modal-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="API Export"
            />
          </div>

          <div className="export-field">
            <label>版本号</label>
            <input
              className="modal-input"
              value={version}
              onChange={e => setVersion(e.target.value)}
              placeholder="1.0.0"
            />
          </div>

          {format === 'openapi' && (
            <div className="export-field">
              <label>Base URL（可选）</label>
              <input
                className="modal-input"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
              />
            </div>
          )}

          {selectedIds.length > 0 && (
            <div className="export-scope-info">
              将导出 {selectedIds.length} 个已选接口
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="ad-btn" onClick={closeModal}>取消</button>
          <button
            className="ad-btn ad-btn-primary"
            onClick={handleExport}
            disabled={exporting || !title.trim()}
          >
            {exporting ? '导出中...' : '导出'}
          </button>
        </div>
      </div>
    </div>
  );
}