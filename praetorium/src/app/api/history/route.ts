// ============================================================
// Praetorium — GET /api/history
// ============================================================
//
// Aggrega eventi da 3 risorse Tabularium in una timeline unica:
//   - File Change Journal → file_change events
//   - Project Tasks       → task events
//   - ADR Decisions       → decision events
//
// Le risorse sono chiamate in PARALLELO. Se una fallisce,
// le altre continuano (robustezza).
// ============================================================

import { NextResponse } from 'next/server';
import type { HistoryEvent, HistoryEventType, HistoryResponse } from '@/lib/history/types';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const TABULARIUM_URL =
  process.env.NEXT_PUBLIC_TABULARIUM_URL || 'http://localhost:3100';

const MAX_LIMIT = 200;

// ---------------------------------------------------------------------------
// Helper: fetchResource
// ---------------------------------------------------------------------------

/**
 * Chiama una resource MCP di Tabularium via HTTP bridge.
 * Decodifica il wrapper contents[0].text in un JSON tipizzato.
 * Restituisce null in caso di errore (per robustezza).
 */
async function fetchResource<T>(uri: string): Promise<T | null> {
  try {
    const encoded = encodeURIComponent(uri);
    const res = await fetch(`${TABULARIUM_URL}/api/resources/${encoded}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`[history] Tabularium returned ${res.status} for ${uri}`);
      return null;
    }
    const data = await res.json();
    const text: string = (data.contents?.[0]?.text as string) || '[]';
    return JSON.parse(text) as T;
  } catch (err) {
    console.warn(`[history] fetchResource failed for ${uri}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers: trasformazione
// ---------------------------------------------------------------------------

let eventCounter = 0;

function nextId(prefix: string): string {
  eventCounter++;
  return `${prefix}_${eventCounter}_${Date.now()}`;
}

function toFileChangeEvent(change: Record<string, unknown>): HistoryEvent {
  const ts = String(change.created_at ?? new Date().toISOString());
  const changeType = String(change.change_type ?? 'modified').toUpperCase();
  const agentVal = change.agent ? String(change.agent) : undefined;
  return {
    id: nextId('fc'),
    type: 'file_change' as HistoryEventType,
    timestamp: ts,
    title: `${changeType}: ${String(change.file_path ?? '?')}`,
    description: String(change.summary ?? ''),
    agent: agentVal,
    metadata: { change_type: change.change_type, task_id: change.task_id },
  };
}

function toTaskEvent(task: Record<string, unknown>, now: string): HistoryEvent {
  const agentVal = task.agent ? String(task.agent) : undefined;
  return {
    id: nextId('tsk'),
    type: 'task' as HistoryEventType,
    timestamp: now,
    title: `Task: ${String(task.task ?? '?')}`,
    description: `Priority: ${String(task.priority ?? 'medium')}`,
    agent: agentVal,
    metadata: { status: task.status },
  };
}

function toDecisionEvent(
  record: Record<string, unknown>,
  now: string,
): HistoryEvent {
  const ts = String(record.created_at ?? now);
  return {
    id: nextId('adr'),
    type: 'decision' as HistoryEventType,
    timestamp: ts,
    title: `ADR: ${String(record.title ?? '?')}`,
    description: `Status: ${String(record.status ?? '?')}`,
    metadata: { adr_id: record.id },
  };
}

// ---------------------------------------------------------------------------
// Validazione query params
// ---------------------------------------------------------------------------

interface QueryParams {
  limit: number;
  type: HistoryEventType | 'all';
}

function parseParams(url: string): QueryParams {
  const { searchParams } = new URL(url);

  const rawLimit = searchParams.get('limit');
  const limit = rawLimit
    ? Math.min(Math.max(1, Number(rawLimit)), MAX_LIMIT)
    : 50;

  const rawType = searchParams.get('type') ?? 'all';
  const validTypes: HistoryEventType[] = ['file_change', 'task', 'decision'];
  const type = validTypes.includes(rawType as HistoryEventType)
    ? (rawType as HistoryEventType)
    : 'all';

  return { limit, type };
}

// ---------------------------------------------------------------------------
// Handler GET
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  eventCounter = 0; // reset a ogni richiesta

  const { limit, type: filterType } = parseParams(request.url);

  try {
    // --- Step 1: Fetch da Tabularium IN PARALLELO ---
    const now = new Date().toISOString();

    const [journalData, tasksData, decisionsData] = await Promise.all([
      fetchResource<Record<string, unknown>>(
        `tabularium://journal/recent?limit=${limit}`,
      ),
      fetchResource<Array<Record<string, unknown>>>(
        'tabularium://project/tasks',
      ),
      fetchResource<Record<string, unknown>>(
        'tabularium://decisions/active',
      ),
    ]);

    // --- Step 2: Trasforma in HistoryEvent[] ---
    const allEvents: HistoryEvent[] = [];

    // 2a. File changes
    if (journalData) {
      // @ts-expect-error – i dati arrivano da API esterna senza tipizzazione rigida
      const changes: Array<Record<string, unknown>> = journalData.changes ?? [];
      for (const c of changes) {
        allEvents.push(toFileChangeEvent(c));
      }
    }

    // 2b. Tasks (solo completati)
    if (tasksData && Array.isArray(tasksData)) {
      for (const t of tasksData) {
        if (String(t.status ?? '') === 'completed') {
          allEvents.push(toTaskEvent(t, now));
        }
      }
    }

    // 2c. ADR decisions (attive)
    if (decisionsData) {
      // @ts-expect-error – i dati arrivano da API esterna
      const records: Array<Record<string, unknown>> = decisionsData.records ?? [];
      for (const r of records) {
        allEvents.push(toDecisionEvent(r, now));
      }
    }

    // --- Step 3: Filtra per tipo ---
    const filtered =
      filterType === 'all'
        ? allEvents
        : allEvents.filter((e) => e.type === filterType);

    // --- Step 4: Ordina per timestamp decrescente ---
    filtered.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    // --- Step 5: Tronca al limite richiesto ---
    const events = filtered.slice(0, limit);

    const response: HistoryResponse = {
      events,
      total: filtered.length,
      limit,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[history] Unexpected error:', error);
    return NextResponse.json(
      { events: [], total: 0, limit, error: 'Errore nel caricamento della cronologia' },
      { status: 500 },
    );
  }
}
