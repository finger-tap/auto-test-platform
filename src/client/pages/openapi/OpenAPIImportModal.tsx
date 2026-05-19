import { useState, useRef } from 'react';
import { apiFetch } from '../../utils/api';
import type { ApiResponse, ParseResult } from '../../types';

interface Props {
  onImported?: () => void;
}

export default function OpenAPIImportModal({ onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'file' | 'url'>('file');
  const [urlInput, setUrlInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const openModal = () => {
    setOpen(true);
    setTab('file');
    setUrlInput('');
    setParsing(false);
    setError('');
    setResult(null);
    setSelected(new Set());
    setImportResult('');
  };

  const closeModal = () => {
    setOpen(false);
  };

  const handleParseUrl = async () => {
    if (!urlInput.trim()) return;
    setParsing(true);
    setError('');
    try {
      const res = await apiFetch('/openapi/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      }) as ApiResponse<ParseResult>;
      if (res.code !== 200) throw new Error(res.message);
      setResult(res.data!);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setParsing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setError('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await apiFetch('/openapi/import-file', {
        method: 'POST',
        body: formData,
      }) as ApiResponse<ParseResult>;
      if (res.code !== 200) throw new Error(res.message);
      setResult(res.data!);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse');
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const toggleApi = (idx: number) => {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelected(next);
  };

  const toggleAll = () => {
    if (!result) return;
    if (selected.size === result.apis.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(result.apis.map((_, i) => i)));
    }
  };

  const handleImport = async () => {
    if (!result || selected.size === 0) return;
    setImporting(true);
    setImportResult('');
    try {
      const toImport = result.apis.filter((_, i) => selected.has(i));
      const res = await apiFetch('/openapi/import-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apis: toImport }),
      }) as ApiResponse<{ count: number; ids: number[] }>;
      if (res.code !== 201) throw new Error(res.message);
      setImportResult(`成功导入 ${res.data!.count} 个接口`);
      setTimeout(() => {
        closeModal();
        onImported?.();
      }, 1500);
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const methodColors: Record<string, string> = {
    GET: '#52c41a', POST: '#1677ff', PUT: '#fa8c16',
    DELETE: '#ff4d4f', PATCH: '#722ed1',
  };

  if (!open) {
    return (
      <button className="ad-btn ad-btn-sm" onClick={openModal} style={{ marginLeft: 8 }}>
        📥 导入
      </button>
    );
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal-content openapi-import-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h3>导入接口</h3>
          <button className="modal-close" onClick={closeModal}>✕</button>
        </div>

        {/* Tab switcher */}
        <div className="openapi-tabs">
          <button className={`tab-btn ${tab === 'file' ? 'active' : ''}`} onClick={() => { setTab('file'); setError(''); setResult(null); }}>上传文件</button>
          <button className={`tab-btn ${tab === 'url' ? 'active' : ''}`} onClick={() => { setTab('url'); setError(''); setResult(null); }}>URL 导入</button>
        </div>

        <div className="modal-body">
          {/* File tab */}
          {tab === 'file' && !result && (
            <div className="import-dropzone">
              <input
                ref={fileRef}
                type="file"
                accept=".json,.yaml,.yml"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <div className="dropzone-inner" onClick={() => fileRef.current?.click()}>
                {parsing ? (
                  <div className="loading-state">解析中...</div>
                ) : (
                  <>
                    <div className="dropzone-icon">📂</div>
                    <div className="dropzone-text">点击上传或拖拽文件到这里</div>
                    <div className="dropzone-formats">支持 OpenAPI 3.x · Swagger 2.0 · Postman Collection v2.1 (JSON/YAML)</div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* URL tab */}
          {tab === 'url' && !result && (
            <div className="import-url-form">
              <input
                className="modal-input"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder="输入 Swagger/OpenAPI 文档 URL"
                onKeyDown={e => e.key === 'Enter' && handleParseUrl()}
              />
              <button className="ad-btn" onClick={handleParseUrl} disabled={parsing || !urlInput.trim()}>
                {parsing ? '解析中...' : '解析'}
              </button>
            </div>
          )}

          {/* Error */}
          {error && <div className="import-error">{error}</div>}

          {/* Result preview */}
          {result && (
            <div className="import-result">
              <div className="result-meta">
                <span className="result-format">{result.format === 'openapi3' ? 'OpenAPI 3.0' : result.format === 'swagger2' ? 'Swagger 2.0' : 'Postman Collection'}</span>
                <strong>{result.title}</strong>
                <span>共 {result.apis.length} 个接口</span>
                <button className="ad-btn ad-btn-sm" onClick={() => { setResult(null); setSelected(new Set()); }}>重新选择</button>
              </div>

              <div className="result-actions">
                <button className="ad-btn ad-btn-sm" onClick={toggleAll}>
                  {selected.size === result.apis.length ? '取消全选' : '全选'}
                </button>
                <span>已选 {selected.size} 个</span>
              </div>

              <div className="api-list-preview">
                {result.apis.map((api, idx) => (
                  <div
                    key={idx}
                    className={`api-preview-item ${selected.has(idx) ? 'selected' : ''}`}
                    onClick={() => toggleApi(idx)}
                  >
                    <div className="api-preview-check">
                      <input type="checkbox" checked={selected.has(idx)} readOnly />
                    </div>
                    <div className="api-preview-info">
                      <div className="api-preview-name">{api.name}</div>
                      <div className="api-preview-url">{api.method} {api.url}</div>
                      {api.tags.length > 0 && (
                        <div className="api-preview-tags">{api.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>
                      )}
                    </div>
                    <span
                      className="api-method-badge"
                      style={{ backgroundColor: methodColors[api.method] || '#999' }}
                    >
                      {api.method}
                    </span>
                  </div>
                ))}
              </div>

              <div className="import-footer">
                {importResult && <span className="import-success">{importResult}</span>}
                <button
                  className="ad-btn ad-btn-primary"
                  onClick={handleImport}
                  disabled={importing || selected.size === 0}
                >
                  {importing ? '导入中...' : `导入 ${selected.size} 个接口`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}