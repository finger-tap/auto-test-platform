import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiFetch } from '../utils/api';
import type { Environment, EnvVariable } from '../types';

interface EnvironmentContextValue {
  environments: Environment[];
  activeEnv: Environment | null;
  setActiveEnv: (env: Environment | null) => void;
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

  const setActiveEnv = (env: Environment | null) => {
    setActiveEnvState(env);
    if (env) {
      localStorage.setItem('active_env_id', String(env.id));
    } else {
      localStorage.removeItem('active_env_id');
    }
  };

  const load = () => {
    apiFetch<Environment[]>('/environments').then(res => {
      const r = res as { code?: number; data?: Environment[] };
      if (r.code === 200) {
        const envs = (r.data || []).map(parseEnv);
        setEnvironments(envs);
        const savedId = localStorage.getItem('active_env_id');
        if (savedId) {
          const found = envs.find(e => e.id === Number(savedId));
          if (found) { setActiveEnvState(found); return; }
        }
        const def = envs.find(e => e.is_default === 1);
        setActiveEnvState(def || null);
      }
    }).catch((e: unknown) => { console.error(e); });
  };

  useEffect(() => { load(); }, []);

  return (
    <EnvironmentContext.Provider value={{ environments, activeEnv, setActiveEnv, reload: load }}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment(): EnvironmentContextValue {
  const ctx = useContext(EnvironmentContext);
  if (!ctx) throw new Error('useEnvironment must be used inside EnvironmentProvider');
  return ctx;
}