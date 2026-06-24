import { useSyncExternalStore } from 'react';

type ThemeMode = 'light' | 'dark';

function getTheme(): ThemeMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  window.addEventListener('storage', callback);
  return () => {
    observer.disconnect();
    window.removeEventListener('storage', callback);
  };
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, getTheme, () => 'light' as ThemeMode);
}
