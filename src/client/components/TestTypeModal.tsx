import { useNavigate } from 'react-router-dom';
import './TestTypeModal.css';

const TEST_TYPES = [
  { key: 'api', label: '接口测试', icon: '🔌', desc: 'HTTP/WebSocket 接口调试与自动化' },
  { key: 'web', label: 'Web 测试', icon: '🌐', desc: '浏览器自动化测试' },
  { key: 'mobile', label: '移动端测试', icon: '📱', desc: 'Android / iOS 自动化测试' },
  { key: 'pc', label: 'PC 测试', icon: '🖥️', desc: '桌面应用自动化测试' },
];

interface TestTypeModalProps {
  open: boolean;
  onClose: () => void;
}

export default function TestTypeModal({ open, onClose }: TestTypeModalProps) {
  const navigate = useNavigate();

  if (!open) return null;

  const handleSelect = (key: string) => {
    if (key === 'api') {
      onClose();
      navigate('/api-test');
    } else {
      alert('该功能正在开发中，敬请期待！');
    }
  };

  return (
    <div className="ttm-overlay" onClick={onClose}>
      <div className="ttm-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="ttm-title">选择测试类型</h3>
        <div className="ttm-grid">
          {TEST_TYPES.map((t) => (
            <button key={t.key} className="ttm-card" onClick={() => handleSelect(t.key)}>
              <span className="ttm-icon">{t.icon}</span>
              <span className="ttm-label">{t.label}</span>
              <span className="ttm-desc">{t.desc}</span>
            </button>
          ))}
        </div>
        <button className="ttm-close" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
