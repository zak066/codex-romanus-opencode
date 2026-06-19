'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import type { AgentDTO, AgentsResponse, QualityScorecardDTO, ModelConfig } from './types';

// ─── State & Actions ─────────────────────────────────────────────────────────

interface PraetoriumState {
  agents: AgentDTO[];
  agentsLoading: boolean;
  quality: QualityScorecardDTO | null;
  qualityLoading: boolean;
  modelConfig: ModelConfig[];
  modelConfigLoading: boolean;
  error: string | null;
  lastRefresh: Date | null;
}

interface PraetoriumActions {
  refresh: () => Promise<void>;
  setModelConfig: (config: ModelConfig[]) => void;
  clearError: () => void;
}

type PraetoriumContextType = PraetoriumState & PraetoriumActions;

const INITIAL_STATE: PraetoriumState = {
  agents: [],
  agentsLoading: false,
  quality: null,
  qualityLoading: false,
  modelConfig: [],
  modelConfigLoading: false,
  error: null,
  lastRefresh: null,
};

const PraetoriumContext = createContext<PraetoriumContextType | undefined>(undefined);

export function usePraetorium() {
  const ctx = useContext(PraetoriumContext);
  if (!ctx) {
    throw new Error('usePraetorium must be used within PraetoriumProvider');
  }
  return ctx;
}

function usePolling(
  callback: () => Promise<void>,
  intervalMs: number = 10_000,
  enabled: boolean = true,
) {
  const savedCallback = useRef(callback);
  useEffect(() => { savedCallback.current = callback; }, [callback]);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => { savedCallback.current().catch(() => {}); };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
}

export function PraetoriumProvider({
  children,
  pollingIntervalMs = 10_000,
}: {
  children: React.ReactNode;
  pollingIntervalMs?: number;
}) {
  const [state, setState] = useState<PraetoriumState>(INITIAL_STATE);

  const refresh = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      agentsLoading: true,
      qualityLoading: true,
      modelConfigLoading: true,
      error: null,
    }));

    try {
      const [agentsRes, qualityRes, modelConfigRes] = await Promise.allSettled([
        fetch('/api/agents').then((r) => r.json()) as Promise<AgentsResponse>,
        fetch('/api/quality').then((r) => r.json()) as Promise<QualityScorecardDTO>,
        fetch('/api/models').then((r) => r.json()).then((d) => (d as { agents?: ModelConfig[] }).agents ?? []),
      ]);

      setState((prev) => ({
        ...prev,
        agents:
          agentsRes.status === 'fulfilled'
            ? (agentsRes.value as AgentsResponse).agents ?? []
            : prev.agents,
        quality:
          qualityRes.status === 'fulfilled'
            ? (qualityRes.value as QualityScorecardDTO)
            : prev.quality,
        modelConfig:
          modelConfigRes.status === 'fulfilled'
            ? (modelConfigRes.value as ModelConfig[])
            : prev.modelConfig,
        agentsLoading: false,
        qualityLoading: false,
        modelConfigLoading: false,
        lastRefresh: new Date(),
        error:
          agentsRes.status === 'rejected' ||
          qualityRes.status === 'rejected' ||
          modelConfigRes.status === 'rejected'
            ? 'Alcune richieste non sono riuscite'
            : null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        agentsLoading: false,
        qualityLoading: false,
        modelConfigLoading: false,
        error: err instanceof Error ? err.message : 'Errore sconosciuto',
      }));
    }
  }, []);

  const setModelConfig = useCallback((config: ModelConfig[]) => {
    setState((prev) => ({ ...prev, modelConfig: config }));
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  usePolling(refresh, pollingIntervalMs);

  return (
    <PraetoriumContext.Provider value={{ ...state, refresh, setModelConfig, clearError }}>
      {children}
    </PraetoriumContext.Provider>
  );
}
