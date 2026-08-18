import { useState, useRef, useEffect } from 'react';

/**
 * Small create modal for team / project. Reuses the shared modal+form systems.
 */
interface Props {
  mode: 'create-team' | 'create-project';
  onClose: () => void;
  onSubmit: (name: string, description: string) => Promise<void>;
}

export default function TeamOrgModal({ mode, onClose, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(name.trim(), description.trim());
      // parent closes on success
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="modal modal-sm">
        <div className="modal-header">
          <div className="modal-title">{mode === 'create-team' ? '新建团队' : '新建项目'}</div>
          <button className="modal-close" onClick={onClose} title="关闭">×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">名称</label>
            <input
              className="form-input"
              autoFocus
              placeholder={mode === 'create-team' ? '例如：测试一组' : '例如：商城 App 回归'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </div>
          <div className="form-group">
            <label className="form-label">描述（可选）</label>
            <input
              className="form-input"
              placeholder="一句话说明"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-default" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={submitting || !name.trim()}
          >
            {submitting ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
