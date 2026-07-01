import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { apiFetch, getToken } from '../utils/api';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): Theme {
  const stored = localStorage.getItem('theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  // Apply to DOM + localStorage immediately
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Load theme from DB (only if logged in)
  const loadFromDb = useCallback(() => {
    if (!getToken()) return;
    apiFetch<{ value: string | null }>('/user-preferences/settings/theme').then(res => {
      const dbTheme = res.data?.value;
      if (dbTheme === 'dark' || dbTheme === 'light') {
        setTheme(dbTheme);
      }
    }).catch(() => {});
  }, []);

  // Load from DB on mount if already logged in
  useEffect(() => { loadFromDb(); }, [loadFromDb]);

  // Load from DB after login (auth-changed event)
  useEffect(() => {
    window.addEventListener('auth-changed', loadFromDb);
    return () => window.removeEventListener('auth-changed', loadFromDb);
  }, [loadFromDb]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      if (getToken()) {
        apiFetch('/user-preferences/settings/theme', {
          method: 'PUT',
          body: JSON.stringify({ value: next }),
        }).catch(() => {});
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used inside ThemeProvider');
  return ctx;
}
