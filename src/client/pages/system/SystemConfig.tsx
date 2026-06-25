import { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import notification from '../../utils/notification';
import './SystemConfig.css';

interface TagInfo {
  name: string;
  color: string;
  count: number;
  sources: { apis: number; scenarios: number; scenario_sets: number };
}

const PRESET_COLORS = [
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316', '#f59e0b',
  '#eab308', '#84cc16',
];

export default function SystemConfig() {
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTag, setNewTag] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchTags = () => {
    setLoading(true);
    apiFetch<TagInfo[]>('/tags').then(res => {
      if (res.code === 200 && res.data) setTags(res.data);
    }).catch(() => notification.error('加载失败')).finally(() => setLoading(false));
  };

  useEffect(() => { fetchTags(); }, []);

  const handleAddTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    try {
      await apiFetch('/tags', { method: 'POST', body: JSON.stringify({ name, color: newColor }) });
      setNewTag('');
      fetchTags();
      notification.success('标签添加成功');
    } catch {
      notification.error('添加失败');
    }
  };

  const handleDeleteTag = async (tagName: string) => {
    const ok = await notification.confirm(`确定删除标签「${tagName}」？该标签将从所有用例和场景中移除。`);
    if (!ok) return;
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
    const colorChanged = editColor !== (tags.find(t => t.name === oldName)?.color || '');
    if ((!name || name === oldName) && !colorChanged) {
      setEditingTag(null);
      return;
    }
    try {
      await apiFetch(`/tags/${encodeURIComponent(oldName)}/rename`, {
        method: 'PUT',
        body: JSON.stringify({ newName: name || oldName, color: editColor })
      });
      setEditingTag(null);
      fetchTags();
      if (name && name !== oldName) {
        notification.success(`「${oldName}」已重命名为「${name}」`);
      } else {
        notification.success('标签颜色已更新');
      }
    } catch {
      notification.error('保存失败');
    }
  };

  const startEdit = (tag: TagInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTag(tag.name);
    setEditName(tag.name);
    setEditColor(tag.color || '#3b82f6');
  };

  const startEditKeyDown = (tag: TagInfo, e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setEditingTag(tag.name);
      setEditName(tag.name);
      setEditColor(tag.color || '#3b82f6');
    }
  };

  return (
    <div className="sys-root">
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
          <div className="sys-tag-color-row">
            {PRESET_COLORS.map(c => (
              <span
                key={c}
                className={`sys-tag-color-swatch ${newColor === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setNewColor(c)}
              />
            ))}
          </div>
          <button className="sys-tag-add-btn" onClick={handleAddTag}>添加</button>
        </div>

        {loading ? (
          <div className="sys-tag-loading">加载中...</div>
        ) : tags.length === 0 ? (
          <div className="sys-tag-empty">暂无标签</div>
        ) : (
          <div className="sys-tag-list">
            {tags.map(tag => (
              <div
                key={tag.name}
                className="sys-tag-item"
                style={tag.color ? {
                  background: `${tag.color}18`,
                  borderColor: `${tag.color}40`,
                } : undefined}
              >
                {editingTag === tag.name ? (
                  <div className="sys-tag-edit-wrap">
                    <input
                      className="sys-tag-edit-input"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRenameTag(tag.name);
                        if (e.key === 'Escape') setEditingTag(null);
                      }}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                    />
                    <div className="sys-tag-edit-colors">
                      {PRESET_COLORS.map(c => (
                        <span
                          key={c}
                          className={`sys-tag-color-swatch sm ${editColor === c ? 'active' : ''}`}
                          style={{ background: c }}
                          onClick={() => setEditColor(c)}
                        />
                      ))}
                    </div>
                    <div className="sys-tag-edit-actions">
                      <button className="sys-tag-edit-save" onClick={() => handleRenameTag(tag.name)}>保存</button>
                      <button className="sys-tag-edit-cancel" onClick={() => setEditingTag(null)}>取消</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span
                      className="sys-tag-color-dot"
                      style={{ background: tag.color || '#94a3b8' }}
                    />
                    <span
                      className="sys-tag-name"
                      style={tag.color ? { color: tag.color } : undefined}
                      onClick={e => startEdit(tag, e)}
                      onKeyDown={e => startEditKeyDown(tag, e)}
                      tabIndex={0}
                      role="button"
                    >
                      {tag.name}
                    </span>
                    <span className="sys-tag-count">{tag.count}个引用</span>
                    <div className="sys-tag-actions">
                      <span
                        className="sys-tag-edit-icon"
                        onClick={e => startEdit(tag, e)}
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