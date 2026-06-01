import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { formatDateTime } from '../../utils/datetime';
import FormSelect from '../../components/FormSelect';
import './MockList.css';

interface MockEndpoint {
  id: number;
  name: string;
  method: string;
  path_pattern: string;
  description: string | null;
  status: string;
  response_status: number;
  response_delay_ms: number;
  enabled: number;
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
  updated_at: string;
}

export default function MockList({ basePath = '/api-test', testType = 'api' }: { basePath?: string; testType?: string } = {}) {
  const navigate = useNavigate();
  const mocksPath = `/mocks-${testType}`;
  const [mocks, setMocks] = useState<MockEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filter
  const [fName, setFName] = useState('');
  const [fMethod, setFMethod] = useState('');
  const [fPath, setFPath] = useState('');

  const fetchMocks = async (pageNum = 1, pageSz = pageSize) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: MockEndpoint[]; total: number; totalPages: number }>(
        `${mocksPath}?page=${pageNum}&pageSize=${pageSz}`
      );
      if (res.code === 200 && res.data) {
        setMocks(res.data.items);
        setTotal(res.data.total);
        setTotalPages(res.data.totalPages);
        setPage(pageNum);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMocks(); }, []);

  async function doDelete(id: number, name: string) {
    if (!confirm(`确认删除 Mock「${name}」？`)) return;
    await apiFetch(`${mocksPath}/${id}`, { method: 'DELETE' });
    fetchMocks(page, pageSize);
  }

  function toggleEnabled(mock: MockEndpoint) {
    const newEnabled = mock.enabled ? 0 : 1;
    const newStatus = mock.status === 'active' ? 'disabled' : 'active';
    apiFetch(`${mocksPath}/${mock.id}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: newEnabled, status: newStatus }),
    }).then(() => fetchMocks(page, pageSize));
  }

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    fetchMocks(newPage, pageSize);
  };

  const METHOD_COLORS: Record<string, string> = {
    GET: '#52c41a', POST: '#1677ff', PUT: '#faad14', DELETE: '#ff4d4f', PATCH: '#722ed1', '*': '#999',
  };

  const filtered = mocks.filter(m => {
    if (fName && !m.name.toLowerCase().includes(fName.toLowerCase())) return false;
    if (fMethod && m.method !== fMethod) return false;
    if (fPath && !m.path_pattern.toLowerCase().includes(fPath.toLowerCase())) return false;
    return true;
  });

  const handleReset = () => { setFName(''); setFMethod(''); setFPath(''); };

  return (
    <div className="mock-list-root">
      {/* Filter Area */}
      <div className="alist-filter">
        <div className="alist-filter-row">
          <div className="alist-filter-item">
            <label>名称</label>
            <input placeholder="搜索名称" value={fName} onChange={e => setFName(e.target.value)} />
          </div>
          <div className="alist-filter-item">
            <label>方法</label>
            <FormSelect
              value={fMethod}
              options={[{ value: '', label: '全部' }, { value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }, { value: 'DELETE', label: 'DELETE' }, { value: 'PATCH', label: 'PATCH' }, { value: '*', label: '*' }]}
              onChange={val => setFMethod(val)}
            />
          </div>
          <div className="alist-filter-item">
            <label>路径</label>
            <input placeholder="搜索路径" value={fPath} onChange={e => setFPath(e.target.value)} />
          </div>
          <div className="alist-filter-actions">
            <button className="btn btn-default" onClick={handleReset}>重置</button>
            <button className="btn btn-primary" onClick={() => navigate(`${basePath}/mock/new`)}>新增</button>
          </div>
        </div>
      </div>

      {/* Table */}
      {loading && mocks.length === 0 ? (
        <div className="alist-loading">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="alist-empty">
          <p>暂无 Mock 端点</p>
          <p className="alist-empty-hint">创建 Mock 端点，可拦截指定请求并返回预设响应</p>
          <button className="sset-btn-create" onClick={() => navigate(`${basePath}/mock/new`)}>+ 新建第一个 Mock</button>
        </div>
      ) : (
        <>
          <div className="alist-table-wrap">
            <table className="alist-table">
              <thead>
                <tr>
                  <th style={{ width: 72 }}>状态</th>
                  <th>名称</th>
                  <th style={{ width: 72 }}>方法</th>
                  <th>路径</th>
                  <th style={{ width: 70 }}>状态码</th>
                  <th style={{ width: 72 }}>延迟</th>
                  <th style={{ width: 56 }}>命中</th>
                  <th style={{ width: 148 }}>更新时间</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr
                    key={m.id}
                    className={`alist-row ${m.enabled ? '' : 'alist-row-disabled'}`}
                    onClick={() => navigate(`${basePath}/mock/${m.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td onClick={e => e.stopPropagation()}>
                      <button className={`mock-enabled-btn ${m.enabled ? 'on' : 'off'}`} onClick={() => toggleEnabled(m)}>
                        {m.enabled ? '启用' : '禁用'}
                      </button>
                    </td>
                    <td className="alist-name-col mock-name">{m.name}</td>
                    <td>
                      <span className="mock-method-badge" style={{ background: METHOD_COLORS[m.method] || '#999', color: '#fff' }}>
                        {m.method}
                      </span>
                    </td>
                    <td className="mock-path">{m.path_pattern}</td>
                    <td className={m.response_status >= 400 ? 'mock-status-error' : ''}>{m.response_status}</td>
                    <td>{m.response_delay_ms > 0 ? `${m.response_delay_ms}ms` : '—'}</td>
                    <td>{m.hit_count}</td>
                    <td className="mock-time">{formatDateTime(m.updated_at)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="row-action-btn" title="编辑" onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/mock/${m.id}`); }}>✎</button>
                        <button className="row-action-btn row-action-del" title="删除" onClick={(e) => { e.stopPropagation(); doDelete(m.id, m.name); }}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="alist-pagination">
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>上一页</button>
            <span className="page-info">{page} / {totalPages}</span>
            <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}>下一页</button>
            <FormSelect value={String(pageSize)} options={[{value:"10",label:"10条/页"},{value:"20",label:"20条/页"},{value:"50",label:"50条/页"}]} onChange={val => fetchMocks(1, Number(val))} />
          </div>
        </>
      )}

    </div>
  );
}