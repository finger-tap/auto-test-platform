import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';

/**
 * 获取用户所有标签的颜色映射（name → color）
 * 列表页用 inline style 渲染标签颜色，替代硬编码 CSS
 */
export function useTagColors(): Map<string, string> {
  const [colorMap, setColorMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    apiFetch<{ name: string; color: string }[]>('/tags').then(res => {
      if (res.code === 200 && res.data) {
        const map = new Map<string, string>();
        for (const tag of res.data) {
          if (tag.color) map.set(tag.name, tag.color);
        }
        setColorMap(map);
      }
    }).catch(() => { /* ignore */ });
  }, []);

  return colorMap;
}

/** 根据主色生成 tag pill 内联样式 */
export function tagBadgeStyle(color: string): React.CSSProperties | undefined {
  if (!color) return undefined;
  return {
    background: `${color}18`,
    color,
    borderColor: `${color}40`,
  };
}
