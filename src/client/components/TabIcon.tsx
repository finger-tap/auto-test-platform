import type { ReactNode } from 'react';

/**
 * 详情页 tab 小图标 (2026-08-28): 16px 线性风格, stroke 继承文字色 —
 * active 时自动变主题色。全部详情页的 TABS 通过 name 引用, 保证
 * 四种测试类型的 tab 视觉语言一致。
 */
const PATHS: Record<string, ReactNode> = {
  detail: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" />
      <path d="M9 10h6M9 14h4" />
    </>
  ),
  env: (
    <>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </>
  ),
  pre: <path d="M11 5 5 12l6 7M19 5l-6 7 6 7" />,
  main: (
    <>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </>
  ),
  post: <path d="m5 5 6 7-6 7M13 5l6 7-6 7" />,
  params: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </>
  ),
  content: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 7h10M7 11h10M7 15h6" />
    </>
  ),
  checkpoints: (
    <>
      <path d="m3 7 2 2 4-4M3 17l2 2 4-4" />
      <path d="M13 6h8M13 18h8" />
    </>
  ),
  data: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </>
  ),
  history: (
    <>
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  device: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M12 18h.01" />
    </>
  ),
  app: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
};

export type TabIconName = keyof typeof PATHS;

export default function TabIcon({ name }: { name: string }) {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name] ?? PATHS.detail}
    </svg>
  );
}
