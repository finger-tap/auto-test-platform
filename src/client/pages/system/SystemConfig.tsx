import { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import notification from '../../utils/notification';
import './SystemConfig.css';

interface TagInfo {
  name: string;
  count: number;
  sources: { apis: number; scenarios: number; scenario_sets: number };
}

export default function SystemConfig() {
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTag, setNewTag] = useState('');
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchTags = () => {
    setLoading(true);
    apiFetch<{ data: TagInfo[] }>('/tags').then(res => {
      if (res.code === 200 && res.data) setTags(res.data);
    }).catch(() => notification.error('加载失败')).finally(() => setLoading(false));
  };

  useEffect(() => { fetchTags(); }, []);

  const handleAddTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    try {
      await apiFetch('/tags', { method: 'POST', body: JSON.stringify({ name }) });
      setNewTag('');
      fetchTags();
      notification.success('标签添加成功');
    } catch {
      notification.error('添加失败');
    }
  };

  const handleDeleteTag = async (tagName: string) => {
    if (!confirm(`确定删除标签「${tagName}」？该标签将从所有用例和场景中移除。`)) return;
    setDeleting(tagName);
    try {
      await apiFetch(`/tags/${encodeURIComponent(tagName)}`, { method: 'DELETE' });
      fetchTags();
      notification.success(`「${tagName}」已删除`);
    } catch {
      notification.error('删除失败');
    } finally {
      setDeleting(null);
    }
  };

  const handleRenameTag = async (oldName: string) => {
    const name = editName.trim();
    if (!name || name === oldName) {
      setEditingTag(null);
      return;
    }
    try {
      await apiFetch(`/tags/${encodeURIComponent(oldName)}/rename`, {
        method: 'PUT',
        body: JSON.stringify({ newName: name })
      });
      setEditingTag(null);
      fetchTags();
      notification.success(`「${oldName}」已重命名为「${name}」`);
    } catch {
      notification.error('重命名失败');
    }
  };

  const startEdit = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTag(name);
    setEditName(name);
  };

  const startEditKeyDown = (name: string, e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setEditingTag(name);
      setEditName(name);
    }
  };

  return (
    <div className="sys-root">
      <div className="sys-head">
        <h2>系统配置</h2>
      </div>

      {/* Tag Management Module */}
      <div className="sys-card">
        <div className="sys-card-title">标签管理</div>
        <div className="sys-card-desc">管理所有已使用的标签，删除标签会自动从相关用例和场景中清除引用</div>

        <div className="sys-tag-add">
          <input
            className="sys-tag-input"
            placeholder="输入标签名称"
            value={newTag}
            onChange={e => setNewTag(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddTag()}
          />
          <button className="sys-tag-add-btn" onClick={handleAddTag}>添加</button>
        </div>

        {loading ? (
          <div className="sys-tag-loading">加载中...</div>
        ) : tags.length === 0 ? (
          <div className="sys-tag-empty">暂无标签</div>
        ) : (
          <div className="sys-tag-list">
            {tags.map(tag => (
              <div key={tag.name} className="sys-tag-item">
                {editingTag === tag.name ? (
                  <input
                    className="sys-tag-edit-input"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={() => handleRenameTag(tag.name)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRenameTag(tag.name);
                      if (e.key === 'Escape') setEditingTag(null);
                    }}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span
                      className="sys-tag-name"
                      onClick={e => startEdit(tag.name, e)}
                      onKeyDown={e => startEditKeyDown(tag.name, e)}
                      tabIndex={0}
                      role="button"
                    >
                      {tag.name}
                    </span>
                    <span className="sys-tag-count">{tag.count}个引用</span>
                    <div className="sys-tag-actions">
                      <span
                        className="sys-tag-edit-icon"
                        onClick={e => startEdit(tag.name, e)}
                        title="编辑"
                      >✎</span>
                      <span
                        className="sys-tag-del-icon"
                        onClick={() => !deleting && handleDeleteTag(tag.name)}
                        title="删除"
                      >
                        {deleting === tag.name ? '...' : '✕'}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}