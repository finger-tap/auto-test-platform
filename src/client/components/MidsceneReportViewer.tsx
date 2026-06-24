import { useRef, useState, useEffect, useMemo } from 'react';
import notification from '../utils/notification';
import { useThemeMode } from '../hooks/useThemeMode';
import './MidsceneReportViewer.css';

interface Props {
  reportPath: string | null | undefined;
  label?: string;
}

type ReportStatus = 'loading' | 'ok' | 'missing' | 'error';

export default function MidsceneReportViewer({ reportPath, label = 'Midscene 报告' }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [status, setStatus] = useState<ReportStatus>('loading');
  const theme = useThemeMode();

  // Always pass darkMode explicitly so the URL param overrides the report's
  // internal localStorage, keeping the report theme in sync with the platform.
  const themedReportUrl = useMemo(() => {
    if (!reportPath) return reportPath;
    const url = new URL(reportPath, window.location.origin);
    url.searchParams.set('darkMode', theme === 'dark' ? 'true' : 'false');
    return url.pathname + url.search;
  }, [reportPath, theme]);

  // Probe report availability before rendering iframe.
  // Avoids showing the SPA home page inside the iframe when the
  // report file is missing or inaccessible.
  useEffect(() => {
    if (!reportPath) { setStatus('missing'); return; }
    let cancelled = false;
    setStatus('loading');
    fetch(reportPath, { method: 'HEAD', credentials: 'include' })
      .then(res => {
        if (cancelled) return;
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('text/html')) {
          setStatus('ok');
        } else if (res.status === 404) {
          setStatus('missing');
        } else if (res.status === 403) {
          setStatus('error');
        } else {
          // Non-HTML response (e.g. SPA fallback serving index.html for
          // a route that should be a report) — treat as missing.
          setStatus('missing');
        }
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [reportPath, reloadKey]);

  if (!reportPath || status === 'missing') {
    return (
      <div className="mrv-empty">
        <div className="mrv-empty-icon">📄</div>
        <div className="mrv-empty-text">未找到测试报告</div>
        <div className="mrv-empty-hint">执行异常或执行尚未完成时会出现此提示</div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mrv-empty">
        <div className="mrv-empty-icon">⚠️</div>
        <div className="mrv-empty-text">报告文件无法访问</div>
        <div className="mrv-empty-hint">文件可能已被删除或存储路径无读取权限，请检查系统设置中的报告路径配置</div>
      </div>
    );
  }

  const handleOpenInNewTab = () => {
    window.open(themedReportUrl, '_blank', 'noopener,noreferrer');
  };

  const handleRefresh = () => {
    setReloadKey((k) => k + 1);
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
      {status === 'loading' ? (
        <div className="mrv-loading">加载中...</div>
      ) : (
        <iframe
          key={reloadKey}
          ref={iframeRef}
          className="mrv-frame"
          src={themedReportUrl}
          title={label}
          sandbox="allow-scripts allow-same-origin"
        />
      )}
    </div>
  );
}
