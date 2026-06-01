import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import FormSelect from '../../components/FormSelect';
import '../../pages/api-test/ApiList.css';

interface CaseItem {
  id: number;
  name: string;
  tags: string;
  steps: number;
  status: string;
  updated_at: string;
}

interface ListResponse {
  items: CaseItem[];
  total: number;
  page: number;
  pageSize: number;
}

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

export default function PcCaseList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [fName, setFName] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fTag, setFTag] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '20',
    });
    if (fName) params.set('name', fName);
    if (fStatus) params.set('status', fStatus);
    if (fTag) params.set('tag', fTag);

    apiFetch<ListResponse>(`/pc-cases?${params}`)
      .then(res => {
        if (res.code === 200 && res.data) {
          setItems(res.data.items || []);
          setTotal(res.data.total || 0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, fName, fStatus, fTag]);

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm('确认删除此用例？')) return;
    apiFetch(`/pc-cases/${id}`, { method: 'DELETE' }).then(res => {
      if (res.code === 200) setItems(prev => prev.filter(i => i.id !== id));
    });
  };

  const totalPages = Math.ceil(total / 20) || 1;

  return (
    <div className="alist">
      <div className="alist-filter">
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>用例名称</label>
            <input placeholder="搜索用例名称..." value={fName} onChange={e => { setFName(e.target.value); setPage(1); }} />
          </div>
          <div className="alist-filter-item">
            <label>标签</label>
            <FormSelect
              value={fTag}
              options={[{ value: '', label: '全部标签' }, { value: '核心', label: '核心' }, { value: '认证', label: '认证' }, { value: '订单', label: '订单' }, { value: '回归', label: '回归' }]}
              onChange={val => { setFTag(val); setPage(1); }}
            />
          </div>
          <div className="alist-filter-item">
            <label>状态</label>
            <FormSelect
              value={fStatus}
              options={[{ value: '', label: '全部状态' }, { value: 'active', label: '启用' }, { value: 'disabled', label: '禁用' }, { value: 'draft', label: '草稿' }]}
              onChange={val => { setFStatus(val); setPage(1); }}
            />
          </div>
          <div className="alist-actions">
            <button className="btn btn-default" onClick={() => navigate('/pc-test/case/new')}>+ 新建用例</button>
          </div>
        </div>
      </div>

      <div className="alist-table-wrap">
        {loading ? (
          <div className="alist-empty">加载中...</div>
        ) : items.length === 0 ? (
          <div className="alist-empty">暂无数据</div>
        ) : (
          <table className="alist-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>标签</th>
                <th>步骤数</th>
                <th>状态</th>
                <th>更新时间</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id} onClick={() => navigate(`/pc-test/case/${c.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 500 }}>{c.name}</td>
                  <td>
                    {c.tags ? c.tags.split(',').filter(Boolean).map(t => (
                      <span key={t} className="tag-badge" data-tag={t.trim()}>{t.trim()}</span>
                    )) : '-'}
                  </td>
                  <td className="td-mono" style={{ fontFamily: 'var(--font-mono)' }}>{c.steps ?? 0}</td>
                  <td><span className={`status-text status-${c.status}`}>{statusLabel(c.status)}</span></td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                    {formatDateTime(c.updated_at)}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" title="执行" onClick={e => { e.stopPropagation(); navigate(`/pc-test/case/${c.id}?exec=1`); }}>▶</button>
                      <button className="row-action-btn row-action-del" title="删除" onClick={e => handleDelete(e, c.id)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="alist-pagination">
        <span className="page-info">共 {total} 条，第 {page} / {totalPages} 页</span>
        <div className="page-btns">
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
          <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
        </div>
      </div>
    </div>
  );
}