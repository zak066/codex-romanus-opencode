'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Brain, AlertCircle } from 'lucide-react';
import {
  Card,
  Button,
  LoadingSpinner,
} from '@/components/ui';
import { AGENT_COLORS_CLASSES } from '@/lib/agent-colors';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentConfig {
  name: string;
  model: string;
  role: string;
  color?: string;
  temperature?: number;
  maxTokens?: number;
  capabilities?: string[];
}

interface AvailableModel {
  id: string;
  provider: 'go' | 'zen';
}

interface AvailableModelsResponse {
  go: AvailableModel[];
  zen: AvailableModel[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFullModelId(model: AvailableModel): string {
  if (model.provider === 'zen') return `opencode/${model.id}`;
  return `opencode-go/${model.id}`;
}

function groupModels(models: AvailableModel[]): {
  featured: AvailableModel[];
  go: AvailableModel[];
  zen: AvailableModel[];
} {
  const featured: AvailableModel[] = [];
  const go: AvailableModel[] = [];
  const zen: AvailableModel[] = [];

  for (const m of models) {
    // ⭐ In Evidenza: big-pickle (sempre primo) + modelli con "free" nel nome
    if (m.id === 'big-pickle' || m.id.includes('free')) {
      featured.push(m);
    } else if (m.provider === 'go') {
      go.push(m);
    } else {
      zen.push(m);
    }
  }

  featured.sort((a, b) => {
    if (a.id === 'big-pickle') return -1;
    if (b.id === 'big-pickle') return 1;
    return a.id.localeCompare(b.id);
  });

  go.sort((a, b) => a.id.localeCompare(b.id));
  zen.sort((a, b) => a.id.localeCompare(b.id));

  return { featured, go, zen };
}

// ─── Models Page ─────────────────────────────────────────────────────────────

export default function ModelsPage() {
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [configsLoading, setConfigsLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch agent configs from /api/models
  const fetchAgentConfigs = useCallback(async () => {
    try {
      setConfigsLoading(true);
      const res = await fetch('/api/models');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { agents: AgentConfig[] };
      setAgentConfigs(data.agents || []);
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : 'Failed to load agent configs',
      );
    } finally {
      setConfigsLoading(false);
    }
  }, []);

  // Fetch available models from /api/models/available
  const fetchAvailableModels = useCallback(async () => {
    try {
      setModelsLoading(true);
      const res = await fetch('/api/models/available');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AvailableModelsResponse;
      const all = [...(data.go || []), ...(data.zen || [])];
      setAvailableModels(all);
    } catch {
      // Non aggiorniamo fetchError qui — i modelli non sono critici
      setAvailableModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgentConfigs();
    fetchAvailableModels();
  }, [fetchAgentConfigs, fetchAvailableModels]);

  // Handle model change
  const handleModelChange = useCallback(
    async (agentName: string, newModel: string) => {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName, updates: { model: newModel } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Ricarica i dati locali
      await fetchAgentConfigs();
    },
    [fetchAgentConfigs],
  );

  // Group available models
  const { featured, go, zen } = React.useMemo(
    () => groupModels(availableModels),
    [availableModels],
  );

  // ─── Loading state ──────────────────────────────────────────────────────────

  if (configsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <LoadingSpinner size="lg" />
        <p className="text-text-muted text-sm">Caricamento modelli...</p>
      </div>
    );
  }

  // ─── Error state ─────────────────────────────────────────────────────────────

  if (fetchError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-roman-gold" />
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Models</h1>
            <p className="text-text-muted mt-1">
              Gestisci configurazione modelli degli agenti
            </p>
          </div>
        </div>

        <Card className="border-semantic-error/30">
          <Card.Body className="flex flex-col items-center gap-3 py-12">
            <AlertCircle className="w-10 h-10 text-semantic-error" />
            <p className="text-text-primary font-medium">
              Errore nel caricamento
            </p>
            <p className="text-text-muted text-sm text-center max-w-md">
              {fetchError}
            </p>
            <Button variant="secondary" onClick={fetchAgentConfigs}>
              Riprova
            </Button>
          </Card.Body>
        </Card>
      </div>
    );
  }

  // ─── Empty state (agenti) ────────────────────────────────────────────────────

  if (agentConfigs.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-roman-gold" />
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Models</h1>
            <p className="text-text-muted mt-1">
              Gestisci configurazione modelli degli agenti
            </p>
          </div>
        </div>

        <Card>
          <Card.Body className="flex flex-col items-center gap-3 py-12">
            <Brain className="w-10 h-10 text-text-muted" />
            <p className="text-text-primary font-medium">
              Nessun agente configurato
            </p>
            <p className="text-text-muted text-sm text-center max-w-md">
              Non ci sono agenti configurati nel sistema. Aggiungi agenti in
              opencode.json per visualizzare e gestire i modelli.
            </p>
            <Button variant="secondary" onClick={fetchAgentConfigs}>
              Aggiorna
            </Button>
          </Card.Body>
        </Card>
      </div>
    );
  }

  // ─── Main view ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-roman-gold" />
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Models</h1>
            <p className="text-text-muted mt-1">
              Gestisci configurazione modelli degli agenti
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchAgentConfigs}>
          Aggiorna
        </Button>
      </div>

      {/* Agent Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agentConfigs.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            featured={featured}
            go={go}
            zen={zen}
            modelsLoading={modelsLoading}
            onModelChange={handleModelChange}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Agent Card ──────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  featured,
  go,
  zen,
  modelsLoading,
  onModelChange,
}: {
  agent: AgentConfig;
  featured: AvailableModel[];
  go: AvailableModel[];
  zen: AvailableModel[];
  modelsLoading: boolean;
  onModelChange: (agentName: string, newModel: string) => void;
}) {
  const agentKey = agent.name.split('-')[0];
  const accentClass =
    AGENT_COLORS_CLASSES[agentKey] || 'border-border-default';

  // Role display: extract from name if not set
  const roleLabel =
    agent.role ||
    agent.name
      .split('-')
      .slice(1)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') ||
    '—';

  return (
    <Card className={`border ${accentClass}`}>
      {/* Header */}
      <Card.Header title={agent.name} subtitle={roleLabel} />

      {/* Body */}
      <Card.Body className="space-y-3">
        {/* Model attuale */}
        <div>
          <span className="text-xs text-text-muted block mb-1">
            Modello attuale
          </span>
          <span className="text-lg font-semibold text-roman-gold tracking-wide font-mono">
            {agent.model || '—'}
          </span>
        </div>

        {/* Select modello */}
        <div className="space-y-1">
          <label className="text-xs text-text-muted">Modello</label>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <LoadingSpinner size="sm" />
              <span>Caricamento modelli...</span>
            </div>
          ) : featured.length === 0 && go.length === 0 && zen.length === 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-text-muted italic">
                Nessun modello disponibile dalle API
              </p>
              <input
                type="text"
                defaultValue={agent.model || ''}
                placeholder="Inserisci ID modello manualmente"
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  if (val && val !== agent.model) {
                    onModelChange(agent.name, val);
                  }
                }}
                className="w-full rounded-lg border border-border-default bg-surface-overlay px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-roman-gold/50"
              />
            </div>
          ) : (
            <select
              value={agent.model || ''}
              onChange={(e) => onModelChange(agent.name, e.target.value)}
              className="w-full rounded-lg border border-border-default bg-surface-overlay px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-roman-gold/50"
            >
              <option value="" disabled>
                Seleziona modello...
              </option>
              {featured.length > 0 && (
                <optgroup label="⭐ In Evidenza">
                  {featured.map((m) => (
                    <option key={`${m.provider}-${m.id}`} value={getFullModelId(m)}>
                      {getFullModelId(m)}
                    </option>
                  ))}
                </optgroup>
              )}
              {go.length > 0 && (
                <optgroup label="Go">
                  {go.map((m) => (
                    <option key={`${m.provider}-${m.id}`} value={getFullModelId(m)}>
                      {getFullModelId(m)}
                    </option>
                  ))}
                </optgroup>
              )}
              {zen.length > 0 && (
                <optgroup label="Zen">
                  {zen.map((m) => (
                    <option key={`${m.provider}-${m.id}`} value={getFullModelId(m)}>
                      {getFullModelId(m)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
        </div>

        {/* Temperature + Max Tokens */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="flex flex-col">
            <span className="text-xs text-text-muted">Temperature</span>
            <span className="text-sm text-text-primary font-mono">
              {agent.temperature?.toFixed(1) ?? '—'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-text-muted">Max Tokens</span>
            <span className="text-sm text-text-primary font-mono">
              {agent.maxTokens?.toLocaleString() ?? '—'}
            </span>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}
