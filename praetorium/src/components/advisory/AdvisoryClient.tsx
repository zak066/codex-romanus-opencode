'use client';
import { useState, useEffect, useCallback } from 'react';
import { ClipboardList } from 'lucide-react';
import type { AdvisoryResponse, AdvisoryMode } from '@/lib/advisory/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import AdvisoryCards from './AdvisoryCards';
import ModeToggle from './ModeToggle';
import LastUpdated from './LastUpdated';

export default function AdvisoryClient() {
  const [mode, setMode] = useState<AdvisoryMode>('high');
  const [data, setData] = useState<AdvisoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAdvisory = useCallback(async (m: AdvisoryMode, force = false) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ mode: m, plan: 'go' });
      if (force) query.set('refresh', 'true');
      const res = await fetch(`/api/advisory?${query}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `HTTP ${res.status}: ${res.statusText}`);
      }
      const json: AdvisoryResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante il caricamento');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAdvisory(mode, false); }, [mode, fetchAdvisory]);

  const handleRefresh = useCallback(() => { fetchAdvisory(mode, true); }, [mode, fetchAdvisory]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ClipboardList className="w-6 h-6 text-roman-gold" />
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Consulenza Modelli</h1>
          <p className="text-text-muted mt-1">
            Raccomandazioni basate sui dati di Artificial Analysis
          </p>
        </div>
        <div className="ml-auto">
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <Card>
          <Card.Body className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3" aria-live="polite">
              <LoadingSpinner size="lg" />
              <p className="text-sm text-text-muted">Analisi in corso...</p>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* Error state */}
      {error && !loading && (
        <Card>
          <Card.Body className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-semantic-error mb-4">{error}</p>
            <Button variant="secondary" onClick={handleRefresh}>
              Riprova
            </Button>
          </Card.Body>
        </Card>
      )}

      {/* Data state */}
      {data && !loading && (
        <>
          <LastUpdated generatedAt={data.generatedAt} onRefresh={handleRefresh} loading={loading} />
          <AdvisoryCards recommendations={data.agents} mode={mode} />
        </>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <Card>
          <Card.Body className="text-center py-20">
            <p className="text-sm text-text-muted">Nessun dato disponibile.</p>
          </Card.Body>
        </Card>
      )}
    </div>
  );
}
