import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import FormSelect from '../../components/FormSelect';
import './MobileTestList.css';

interface MobileTestCase {
  id: number;
  name: string;
  description: string;
  tags: string;
  platform: string;
  device_name: string;
  status: string;
  updated_at: string;
  steps_count?: number;
}

interface ListResponse {
  items: MobileTestCase[];
  total: number;
  page: number;
  pageSize: number;
}

const PLATFORMS = [
  { value: '', label: '全部平台' },
  { value: 'android', label: 'Android' },
  { value: 'ios', label: 'iOS' },
];

const STATUSES = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
  { value: 'draft', label: '草稿' },
];

const statusLabel = (s: string) => {
  if (s === 'active') return '启用';
  if (s === 'disabled') return '禁用';
  if (s === 'draft') return '草稿';
  return s;
};

export default function MobileTestList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<MobileTestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [fName, setFName] = useState('');
  const [fPlatform, setFPlatform] = useState('');
  const [fStatus, setFStatus] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '20',
    });
    if (fName) params.set('name', fName);
    if (fPlatform) params.set('platform', fPlatform);
    if (fStatus) params.set('status', fStatus);

    apiFetch<ListResponse>(`/mobile-tests?${params}`)
      .then(res => {
        if (res.code === 200 && res.data) {
          setItems(res.data.items || []);
          setTotal(res.data.total || 0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, fName, fPlatform, fStatus]);

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm('确认删除此用例？')) return;
    apiFetch(`/mobile-tests/${id}`, { method: 'DELETE' }).then(res => {
      if (res.code === 200) setItems(prev => prev.filter(i => i.id !== id));
    });
  };

  const handleSearch = () => {
    setPage(1);
  };

  const totalPages = Math.ceil(total / 20) || 1;

  return (
    <div className="mtlist">
      <div className="mtlist-filter">
        <div className="mtlist-filter-row">
          <div className="mtlist-filter-item">
            <label>用例名称</label>
            <input
              placeholder="搜索用例名称..."
              value={fName}
              onChange={e => { setFName(e.target.value); setPage(1); }}
            />
          </div>
          <div className="mtlist-filter-item">
            <label>平台</label>
            <FormSelect
              value={fPlatform}
              options={PLATFORMS}
              onChange={val => { setFPlatform(val); setPage(1); }}
            />
          </div>
          <div className="mtlist-filter-item">
            <label>状态</label>
            <FormSelect
              value={fStatus}
              options={STATUSES}
              onChange={val => { setFStatus(val); setPage(1); }}
            />
          </div>
          <div className="mtlist-filter-actions">
            <button className="btn btn-default" onClick={handleSearch}>搜索</button>
            <button className="btn btn-primary" onClick={() => navigate('/mobile-test/test-case/new')}>+ 新建用例</button>
          </div>
        </div>
      </div>

      <div className="mtlist-table-wrap">
        {loading ? (
          <div className="mtlist-empty">加载中...</div>
        ) : items.length === 0 ? (
          <div className="mtlist-empty">暂无数据</div>
        ) : (
          <table className="mtlist-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>平台</th>
                <th>步骤数</th>
                <th>标签</th>
                <th>状态</th>
                <th>更新时间</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id} onClick={() => navigate(`/mobile-test/test-case/${c.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 500 }}>{c.name}</td>
                  <td>
                    <span className={`mtlist-platform mtlist-platform-${c.platform}`}>
                      {c.platform === 'ios' ? 'iOS' : 'Android'}
                    </span>
                  </td>
                  <td className="td-mono" style={{ fontFamily: 'var(--font-mono)' }}>{c.steps_count ?? 0}</td>
                  <td>
                    {c.tags ? c.tags.split(',').filter(Boolean).map(t => (
                      <span key={t} className="mtlist-tag">{t.trim()}</span>
                    )) : '-'}
                  </td>
                  <td><span className={`mtlist-status mtlist-status-${c.status}`}>{statusLabel(c.status)}</span></td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                    {formatDateTime(c.updated_at)}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" title="执行" onClick={e => { e.stopPropagation(); }}>▶</button>
                      <button className="row-action-btn row-action-del" title="删除" onClick={e => handleDelete(e, c.id)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mtlist-pagination">
        <span className="page-info">共 {total} 条，第 {page} / {totalPages} 页</span>
        <div className="page-btns">
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
          <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
        </div>
      </div>
    </div>
  );
}