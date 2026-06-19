'use client';

import { useState, useEffect, useCallback } from 'react';
import { History as HistoryIcon, FileText, CheckCircle, ClipboardList } from 'lucide-react';
import type { HistoryEvent, HistoryEventType, HistoryResponse } from '@/lib/history/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

// ─── Filtri ───────────────────────────────────────────────────
interface FilterOption {
  label: string;
  value: HistoryEventType | 'all';
}

const FILTERS: FilterOption[] = [
  { label: 'Tutti', value: 'all' },
  { label: 'File', value: 'file_change' },
  { label: 'Task', value: 'task' },
  { label: 'Decision', value: 'decision' },
];

// ─── Icone per tipo ───────────────────────────────────────────
const TYPE_ICONS: Record<HistoryEventType, React.ReactNode> = {
  file_change: <FileText className="w-4 h-4 text-roman-gold" aria-hidden="true" />,
  task: <CheckCircle className="w-4 h-4 text-roman-gold" aria-hidden="true" />,
  decision: <ClipboardList className="w-4 h-4 text-roman-gold" aria-hidden="true" />,
};

// ─── Helpers ──────────────────────────────────────────────────
function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Componente pagina ────────────────────────────────────────
export default function HistoryPage() {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<HistoryEventType | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async (type: HistoryEventType | 'all') => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/history?limit=50&type=${type}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `HTTP ${res.status}: ${res.statusText}`);
      }
      const json: HistoryResponse = await res.json();
      setEvents(json.events);
      setTotal(json.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante il caricamento');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHistory(filter); }, [filter, fetchHistory]);

  const handleRetry = useCallback(() => { fetchHistory(filter); }, [filter, fetchHistory]);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <HistoryIcon className="w-6 h-6 text-roman-gold" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold text-text-primary">History</h1>
          <p className="text-text-muted mt-1">Cronologia del progetto</p>
        </div>
      </div>

      {/* ── Filtri inline ────────────────────────────────── */}
      <div className="flex items-center gap-2" role="group" aria-label="Filtra per tipo di evento">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-roman-gold/50 ${
              filter === f.value
                ? 'bg-roman-gold text-text-inverse'
                : 'text-text-muted hover:text-text-secondary bg-transparent'
            }`}
            aria-pressed={filter === f.value}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Loading ──────────────────────────────────────── */}
      {loading && (
        <Card>
          <Card.Body className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3" aria-live="polite">
              <LoadingSpinner size="lg" />
              <p className="text-sm text-text-muted">Caricamento eventi...</p>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* ── Error ────────────────────────────────────────── */}
      {error && !loading && (
        <Card>
          <Card.Body className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-semantic-error mb-4" role="alert">{error}</p>
            <Button variant="danger" onClick={handleRetry}>
              Riprova
            </Button>
          </Card.Body>
        </Card>
      )}

      {/* ── Empty ────────────────────────────────────────── */}
      {!loading && !error && events.length === 0 && (
        <Card>
          <Card.Body className="text-center py-20">
            <p className="text-sm text-text-muted">Nessun evento registrato.</p>
          </Card.Body>
        </Card>
      )}

      {/* ── Timeline ─────────────────────────────────────── */}
      {!loading && !error && events.length > 0 && (
        <Card>
          <Card.Header
            title="Event Timeline"
            subtitle={`${total} event${total !== 1 ? 'i' : ''} trovat${total !== 1 ? 'i' : 'o'}.`}
          />
          <Card.Body className="p-0">
            <ul className="divide-y divide-border-subtle" aria-label="Timeline eventi">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-start gap-4 px-4 sm:px-6 py-3 sm:py-4"
                >
                  {/* Icona */}
                  <div className="mt-0.5 shrink-0" aria-hidden="true">
                    {TYPE_ICONS[event.type]}
                  </div>

                  {/* Testo centrale */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-text-primary">
                        {event.title}
                      </span>
                      {event.agent && (
                        <Badge variant="info" size="sm">
                          {event.agent}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-text-muted mt-0.5 line-clamp-2">
                      {event.description}
                    </p>
                  </div>

                  {/* Timestamp */}
                  <time
                    className="shrink-0 text-xs text-text-muted whitespace-nowrap"
                    dateTime={event.timestamp}
                  >
                    {formatDateTime(event.timestamp)}
                  </time>
                </li>
              ))}
            </ul>
          </Card.Body>
        </Card>
      )}
    </div>
  );
}
