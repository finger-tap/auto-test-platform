import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { apiFetch, getToken } from '../utils/api';
import type { Environment, EnvVariable } from '../types';

interface EnvironmentContextValue {
  environments: Environment[];
  activeEnv: Environment | null;
  setActiveEnv: (env: Environment | null) => void;
  currentTestType: string;
  setCurrentTestType: (t: string) => void;
  reload: () => void;
}

const EnvironmentContext = createContext<EnvironmentContextValue | null>(null);

function parseEnv(raw: any): Environment {
  return {
    ...raw,
    variables: (() => {
      if (Array.isArray(raw.variables)) return raw.variables;
      if (typeof raw.variables === 'string') {
        try { return JSON.parse(raw.variables) as EnvVariable[]; }
        catch { return []; }
      }
      return [];
    })(),
  };
}

export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [activeEnv, setActiveEnvState] = useState<Environment | null>(null);
  const [currentTestType, setCurrentTestType] = useState('api');
  const testTypeRef = useRef('api');
  const loadedRef = useRef(false);

  // Sync testType to ref
  useEffect(() => { testTypeRef.current = currentTestType; }, [currentTestType]);

  // Write preference to server (fire-and-forget)
  const savePreference = useCallback((testType: string, envId: number | null) => {
    apiFetch(`/user-preferences/${testType}`, {
      method: 'PUT',
      body: JSON.stringify({ environmentId: envId }),
    }).catch(() => {});
  }, []);

  // Load environments + restore preference for given testType
  const load = useCallback((testType?: string) => {
    if (!getToken()) return;
    const tt = testType || testTypeRef.current;
    apiFetch<Environment[]>('/environments').then(res => {
      const r = res as { code?: number; data?: Environment[] };
      if (r.code !== 200) return;
      const envs = (r.data || []).map(parseEnv);
      setEnvironments(envs);

      // Try to restore preference from server
      apiFetch<{ environmentId: number | null }>(`/user-preferences/${tt}`).then(pref => {
        const prefEnvId = pref.data?.environmentId;
        if (prefEnvId) {
          const found = envs.find(e => e.id === prefEnvId);
          if (found) { setActiveEnvState(found); loadedRef.current = true; return; }
        }
        // Fallback: default → first
        const def = envs.find(e => e.is_default === 1);
        setActiveEnvState(def || envs[0] || null);
        loadedRef.current = true;
      }).catch(() => {
        // Server failed, fallback to default
        const def = envs.find(e => e.is_default === 1);
        setActiveEnvState(def || envs[0] || null);
        loadedRef.current = true;
      });
    }).catch((e: unknown) => { console.error(e); });
  }, []);

  // setActiveEnv: update state + persist to server
  const setActiveEnv = useCallback((env: Environment | null) => {
    setActiveEnvState(env);
    savePreference(testTypeRef.current, env?.id ?? null);
  }, [savePreference]);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // Reload when testType changes (switching between api/web/pc/mobile)
  useEffect(() => {
    if (loadedRef.current) {
      load(currentTestType);
    }
  }, [currentTestType, load]);

  // Listen for envs-changed event (after saving environment detail)
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('envs-changed', handler);
    return () => window.removeEventListener('envs-changed', handler);
  }, [load]);

  // Reload after login (auth-changed fires from AuthContext)
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('auth-changed', handler);
    return () => window.removeEventListener('auth-changed', handler);
  }, [load]);

  return (
    <EnvironmentContext.Provider value={{
      environments, activeEnv, setActiveEnv,
      currentTestType, setCurrentTestType,
      reload: load,
    }}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment(): EnvironmentContextValue {
  const ctx = useContext(EnvironmentContext);
  if (!ctx) throw new Error('useEnvironment must be used inside EnvironmentProvider');
  return ctx;
}
