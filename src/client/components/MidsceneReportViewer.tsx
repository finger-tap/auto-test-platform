import { useRef, useState } from 'react';
import notification from '../utils/notification';
import './MidsceneReportViewer.css';

interface Props {
  reportPath: string | null | undefined;
  label?: string;
}

export default function MidsceneReportViewer({ reportPath, label = 'Midscene 报告' }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [downloading, setDownloading] = useState(false);

  if (!reportPath) {
    return (
      <div className="mrv-empty">
        <div className="mrv-empty-icon">📄</div>
        <div className="mrv-empty-text">本次执行未生成 Midscene 报告</div>
        <div className="mrv-empty-hint">执行失败或浏览器未安装时会显示此占位</div>
      </div>
    );
  }

  const handleOpenInNewTab = () => {
    window.open(reportPath, '_blank', 'noopener,noreferrer');
  };

  const handleRefresh = () => {
    setReloadKey((k) => k + 1);
    iframeRef.current?.contentWindow?.location.reload();
  };

  // 任务 #39 (修订): 在执行记录页旁边加"导出到本地"按钮.
  // 用 fetch 拿 HTML 内容, 转 Blob 后用 <a download> 触发浏览器下载.
  // 整个 report 目录有 index.html + 静态资源, 单独下载 index.html 离线打不开,
  // 用户拿去主要用于在浏览器里查看/打印/归档. 文件名带 execId 方便区分多次报告.
  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(reportPath!, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      // 从 reportPath 提取 execId:  /midscene-reports/{testType}/{caseId}/{execId}/index.html
      const segments = reportPath!.split('/').filter(Boolean);
      const execId = segments[segments.length - 2] || 'report';
      const a = document.createElement('a');
      a.href = url;
      a.download = `midscene-report-${execId}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 释放 Blob URL — 不立即 revoke, 给浏览器一点时间处理下载.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      notification.error(e instanceof Error ? `下载失败: ${e.message}` : '下载失败');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mrv-wrap">
      <div className="mrv-toolbar">
        <span className="mrv-title">{label}</span>
        <div className="mrv-actions">
          <button type="button" className="mrv-btn" onClick={handleRefresh}>刷新</button>
          <button type="button" className="mrv-btn" onClick={handleOpenInNewTab}>新窗口打开</button>
          <button type="button" className="mrv-btn" onClick={handleDownload} disabled={downloading}>
            {downloading ? '下载中...' : '导出到本地'}
          </button>
        </div>
      </div>
      <iframe
        key={reloadKey}
        ref={iframeRef}
        className="mrv-frame"
        src={reportPath}
        title={label}
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}
