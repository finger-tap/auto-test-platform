import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import './MockList.css';

interface MockEndpoint {
  id: number;
  name: string;
  method: string;
  path_pattern: string;
  description: string | null;
  response_status: number;
  response_delay_ms: number;
  enabled: number;
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
  updated_at: string;
}

export default function MockList() {
  const navigate = useNavigate();
  const [mocks, setMocks] = useState<MockEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMethod, setNewMethod] = useState('GET');
  const [newPath, setNewPath] = useState('');
  const [newStatus, setNewStatus] = useState(200);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [msgOpen, setMsgOpen] = useState(false);

  const fetchMocks = async (pageNum = 1, pageSz = pageSize) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: MockEndpoint[]; total: number; totalPages: number }>(
        `/mocks?page=${pageNum}&pageSize=${pageSz}`
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

  async function doCreate() {
    if (!newName.trim() || !newPath.trim()) {
      setMsg('名称和路径不能为空'); setMsgType('error'); setMsgOpen(true); return;
    }
    setCreating(true);
    try {
      const res = await apiFetch<{ id: number }>('/mocks', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          method: newMethod,
          path_pattern: newPath.trim(),
          response_status: newStatus,
        }),
      });
      if (res.code === 201 && res.data) {
        setShowModal(false);
        setNewName(''); setNewPath(''); setNewMethod('GET'); setNewStatus(200);
        navigate(`/mock/${res.data.id}`);
      } else {
        setMsg(res.message || '创建失败'); setMsgType('error'); setMsgOpen(true);
      }
    } finally {
      setCreating(false);
    }
  }

  async function doDelete(id: number, name: string) {
    if (!confirm(`确认删除 Mock「${name}」？`)) return;
    await apiFetch(`/mocks/${id}`, { method: 'DELETE' });
    fetchMocks(page, pageSize);
  }

  function toggleEnabled(mock: MockEndpoint) {
    apiFetch(`/mocks/${mock.id}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: !mock.enabled }),
    }).then(() => fetchMocks(page, pageSize));
  }

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    fetchMocks(newPage, pageSize);
  };

  const METHOD_COLORS: Record<string, string> = {
    GET: '#52c41a', POST: '#1677ff', PUT: '#faad14', DELETE: '#ff4d4f', PATCH: '#722ed1', '*': '#999',
  };

  return (
    <div className="mock-list-root">
      <div className="mock-list-head">
        <h2>Mock 服务</h2>
        <button className="sset-btn-create" onClick={() => setShowModal(true)}>+ 新建 Mock</button>
      </div>

      {loading && mocks.length === 0 ? (
        <div className="mock-list-loading">加载中...</div>
      ) : mocks.length === 0 ? (
        <div className="mock-list-empty">
          <p>暂无 Mock 端点</p>
          <p className="mock-list-empty-hint">创建 Mock 端点，可拦截指定请求并返回预设响应</p>
          <button className="sset-btn-create" onClick={() => setShowModal(true)}>+ 新建第一个 Mock</button>
        </div>
      ) : (
        <>
          <table className="mock-table">
            <thead>
              <tr>
                <th>状态</th>
                <th>名称</th>
                <th>方法</th>
                <th>路径</th>
                <th>响应状态</th>
                <th>延迟</th>
                <th>命中</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {mocks.map(m => (
                <tr key={m.id} className={`mock-row ${m.enabled ? '' : 'mock-row-disabled'}`}>
                  <td>
                    <button
                      className={`mock-enabled-btn ${m.enabled ? 'on' : 'off'}`}
                      onClick={() => toggleEnabled(m)}
                      title={m.enabled ? '点击禁用' : '点击启用'}
                    >
                      {m.enabled ? '启用' : '禁用'}
                    </button>
                  </td>
                  <td className="mock-name" onClick={() => navigate(`/mock/${m.id}`)}>{m.name}</td>
                  <td>
                    <span
                      className="mock-method-badge"
                      style={{ background: METHOD_COLORS[m.method] || '#999', color: '#fff' }}
                    >
                      {m.method}
                    </span>
                  </td>
                  <td className="mock-path">{m.path_pattern}</td>
                  <td className={m.response_status >= 400 ? 'mock-status-error' : ''}>{m.response_status}</td>
                  <td>{m.response_delay_ms > 0 ? `${m.response_delay_ms}ms` : '—'}</td>
                  <td>{m.hit_count}</td>
                  <td className="mock-time">{m.updated_at.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    <button className="mock-action-btn" onClick={() => navigate(`/mock/${m.id}`)}>编辑</button>
                    <button className="mock-action-btn mock-action-del" onClick={() => doDelete(m.id, m.name)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="alist-pagination">
            <button className="page-btn" disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>上一页</button>
            <span className="page-info">{page} / {totalPages}</span>
            <button className="page-btn" disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}>下一页</button>
            <select className="page-size-select" value={pageSize} onChange={e => fetchMocks(1, Number(e.target.value))}>
              <option value={10}>10条/页</option>
              <option value={20}>20条/页</option>
              <option value={50}>50条/页</option>
            </select>
          </div>
        </>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="sset-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="sset-modal" onClick={e => e.stopPropagation()}>
            <h3>新建 Mock 端点</h3>
            <div className="sset-modal-field">
              <label>名称 <span className="required">*</span></label>
              <input autoFocus placeholder="例如：获取用户列表" value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div className="sset-modal-field" style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label>方法</label>
                <select value={newMethod} onChange={e => setNewMethod(e.target.value)}>
                  {['GET', 'POST', 'PUT', 'DELETE', 'PATCH', '*'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div style={{ flex: 2 }}>
                <label>路径 <span className="required">*</span></label>
                <input placeholder="/api/users/:id" value={newPath} onChange={e => setNewPath(e.target.value)} />
              </div>
            </div>
            <div className="sset-modal-field">
              <label>响应状态码</label>
              <input type="number" value={newStatus} onChange={e => setNewStatus(Number(e.target.value))} />
            </div>
            <div className="sset-modal-actions">
              <button onClick={() => setShowModal(false)}>取消</button>
              <button className="sset-btn-primary" onClick={doCreate} disabled={creating}>
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {msgOpen && <div className="sset-msg-toast" data-type={msgType} onClick={() => setMsgOpen(false)}>{msg}</div>}
    </div>
  );
}