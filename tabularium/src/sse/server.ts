/**
 * sse/server.ts
 * Server HTTP SSE (Server-Sent Events) per Tabularium.
 * Espone endpoint per streaming eventi in tempo reale su porta 3100.
 * Si integra con EventBus per ricevere e inoltrare eventi di messaging.
 *
 * Fondamentali di design:
 * - Zero dipendenze: usa http.createServer nativo di Node 22+
 * - Backpressure: timeout 5min, buffer 100KB, max 50 connessioni
 * - Graceful shutdown: startSseServer() / stopSseServer()
 * - Filtraggio eventi per agente via query param `?agent={name}`
 *
 * @module sse/server
 */

import http from 'node:http';
import url from 'node:url';
import { subscribe, clear as clearEventBus, emit } from '../messaging/event-bus.js';
import { startTtlTimer } from '../messaging/event-ttl.js';
import type { MessagingEvent, MessagingEventType } from '../messaging/event-bus.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Porta di default per il server SSE */
const DEFAULT_SSE_PORT = 3100;

/** Intervallo keepalive SSE (30s) */
const KEEPALIVE_INTERVAL_MS = 30_000;

/** Timeout connessione inattiva (5 minuti) */
const CONNECTION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Massima dimensione del buffer write per connessione (100KB) */
const MAX_WRITE_BUFFER_SIZE = 100 * 1024;

/** Numero massimo di connessioni SSE simultanee */
const MAX_CONNECTIONS = 50;

// ---------------------------------------------------------------------------
// CORS e Autenticazione
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Security Headers HTTP
// ---------------------------------------------------------------------------

/** Headers di sicurezza applicati a tutte le risposte HTTP */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '0',  // Deprecato ma ancora letto da alcuni browser
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // TODO: valutare aggiunta di Content-Security-Policy — attualmente esclusa
  // perché potrebbe interferire con gli SSE events
};

/**
 * Imposta i security headers sulla risposta HTTP.
 * Deve essere chiamato PRIMA di writeHead() per essere efficace.
 */
function setSecurityHeaders(res: http.ServerResponse): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(key, value);
  }
}


/** Origin CORS configurato (da env CORS_ORIGIN, default: http://localhost:3000 per la dashboard) */
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

/**
 * Controlla l'autenticazione via API Key.
 * Legge l'header X-Api-Key e lo confronta con TABULARIUM_API_KEY env.
 * Se l'env var non è impostata (dev mode), permette comunque (fallback per sviluppo).
 * Applicato solo su endpoint POST che modificano stato.
 *
 * @param req - Richiesta HTTP in ingresso
 * @param res - Response HTTP (scrive 401 se non autorizzato)
 * @returns true se autorizzato, false se 401 già inviato
 */
function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const apiKey = process.env.TABULARIUM_API_KEY;
  // Dev mode: se env var non impostata, permetti tutto
  if (!apiKey) return true;

  const providedKey = req.headers['x-api-key'] as string | undefined;
  if (!providedKey || providedKey !== apiKey) {
    setSecurityHeaders(res);
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': CORS_ORIGIN,
    });
    res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing API key' }));
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

/**
 * Stato interno di una connessione SSE.
 */
interface SseConnection {
  id: string;
  /** Response HTTP (write stream SSE) */
  res: http.ServerResponse;
  /** Nome agente per filtraggio (undefined = tutti gli eventi) */
  agentFilter?: string,
  sinceId?: string;
  /** Timestamp connessione */
  connectedAt: number;
  /** Timestamp ultimo evento inviato (per idle timeout) */
  lastActivity: number;
  /** Funzione per rimuovere subscription EventBus */
  unsubscribe: () => void;
  /** Timer idle timeout */
  idleTimer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Stato del server
// ---------------------------------------------------------------------------

/** Istanza del server HTTP */
let server: http.Server | null = null;

/** Mappa delle connessioni attive { connectionId -> SseConnection } */
const connections: Map<string, SseConnection> = new Map();

/** Timestamp di avvio del server (per health check) */
let startedAt = 0;

/** Contatore progressivo ID connessione */
let connectionIdCounter = 0;

// ---------------------------------------------------------------------------
// Lifecycle: start / stop / state
// ---------------------------------------------------------------------------

/**
 * Avvia il server HTTP SSE su porta 3100 (o TABULARIUM_SSE_PORT da env).
 *
 * Il server:
 * 1. Ascolta su porta specificata
 * 2. Registra subscriber all'EventBus per inoltrare eventi ai client
 * 3. Avvia keepalive timer ogni 30s
 *
 * @param port - Porta su cui ascoltare (default: 3100)
 * @returns Promise che risolve quando il server è in ascolto
 */
export function startSseServer(port: number = DEFAULT_SSE_PORT): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (server) {
      console.error(`[sse-server] Already running on port ${port}`);
      resolve();
      return;
    }

    startedAt = Date.now();

    server = http.createServer(handleRequest);

    // Gestisci errori del server
    server.on('error', (err: Error) => {
      console.error('[sse-server] Server error:', err);
      // Non resettare il server qui — lo shutdown pulito è gestito da stopSseServer()
    });

    server.listen(port, () => {
      console.error(`[sse-server] SSE server listening on port ${port}`);
      console.error(`[sse-server] Max connections: ${MAX_CONNECTIONS}`);
      console.error(`[sse-server] Idle timeout: ${CONNECTION_IDLE_TIMEOUT_MS / 1000}s`);
      const stopTtl = startTtlTimer();
      ttlTimerStop = stopTtl;

      resolve();
    });
  });
}

/**
 * Ferma il server SSE con graceful shutdown.
 * - Chiude tutte le connessioni attive
 * - Pulisce i subscriber dell'EventBus
 * - Chiude il server HTTP
 *
 * @returns Promise che risolve quando il server è fermo
 */
export function stopSseServer(): Promise<void> {
  return new Promise<void>((resolve) => {
    // Chiudi tutte le connessioni attive
    for (const [id, conn] of connections) {
      closeConnection(id, conn, 'server_shutdown');
    }
    connections.clear();

    if (ttlTimerStop) {
      ttlTimerStop();
      ttlTimerStop = null;
    }

    // Pulisci subscriber EventBus
    clearEventBus();

    if (!server) {
      resolve();
      return;
    }

    const srv = server;
    server = null;
    startedAt = 0;

    srv.close(() => {
      console.error('[sse-server] Server stopped');
      resolve();
    });
      // Avvia keepalive periodico per mantenere vive le connessioni
      startKeepalive();



    // Timeout sicurezza: se il server non si chiude in 5s, forziamo
    setTimeout(() => {
      console.error('[sse-server] Server close timed out, forcing exit');
      resolve();
    }, 5000);
  });
}

/**
 * Indica se il server SSE è attualmente in esecuzione.
 *
 * @returns true se il server è in ascolto
 */
export function isSseRunning(): boolean {
  return server !== null;
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

/**
 * Dispatch delle richieste HTTP in arrivo.
 * Supporta:
 *  - GET /health → JSON health check
    // Ferma keepalive timer
    stopKeepalive();


 *  - GET /events → SSE stream (tutti eventi)
 *  - GET /events?agent={name} → SSE stream filtrato per agente
 *  - Tutto il resto → 404
 */
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsedUrl = url.parse(req.url ?? '/', true);
  // ── CORS Preflight ─────────────────────────────
  if (req.method === 'OPTIONS') {
    setSecurityHeaders(res);
    res.writeHead(204, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const pathname = parsedUrl.pathname ?? '/';

  try {
    // ── Health check ───────────────────────────
    if (pathname === '/health' && req.method === 'GET') {
      handleHealthCheck(res);
      return;
    }

    // ── SSE events stream ──────────────────────
    if (pathname === '/events' && req.method === 'GET') {
      const agentParam = (parsedUrl.query.agent as string) ?? undefined;
      const sinceParam = (parsedUrl.query.since as string) ?? undefined;
      handleSseConnection(req, res, agentParam, sinceParam);
      return;
    }

    // ── REST API per Dashboard ──────────────────
    if (pathname === '/api/resources' && req.method === 'GET') {
      handleResourceList(res);
      return;
    }

    if (pathname.startsWith('/api/resources/') && req.method === 'GET') {
      const encodedUri = pathname.slice('/api/resources/'.length);
      const resourceUri = decodeURIComponent(encodedUri);
      handleResourceRead(res, resourceUri);
      return;
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      handleHealthCheck(res);
      return;
    }
    // ── POST /api/send-message ──────────────────
    if (pathname === '/api/send-message' && req.method === 'POST') {
      await handleSendMessage(req, res);
      return;
    }


    // ── 404 per tutto il resto ──────────────────
    setSecurityHeaders(res);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', path: pathname }));
  } catch (err) {
    console.error('[sse-server] Error handling request:', err);
      if (!res.headersSent) {
        setSecurityHeaders(res);
        res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Endpoint GET /health.
 * Restituisce JSON con stato del server SSE.
 */
function handleHealthCheck(res: http.ServerResponse): void {
  const uptimeSeconds = startedAt > 0
    ? Math.floor((Date.now() - startedAt) / 1000)
    : 0;

  const healthData = {
    status: 'ok' as const,
    uptime: uptimeSeconds,
    uptime_human: formatUptime(uptimeSeconds),
    listeners: connections.size,
    max_connections: MAX_CONNECTIONS,
    started_at: new Date(startedAt).toISOString(),
    event_bus_listeners: 0, // Verrà popolato da chi integra
  };

  setSecurityHeaders(res);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
  });
  res.end(JSON.stringify(healthData, null, 2));
}

// ---------------------------------------------------------------------------
// REST API handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/resources — Elenca tutte le resource MCP disponibili.
 */
async function handleResourceList(res: http.ServerResponse): Promise<void> {
  try {
    const { registerResources } = await import('../resources/index.js');
    const resources = registerResources();
    setSecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': CORS_ORIGIN,
    });
    res.end(JSON.stringify({ resources }));
  } catch (err) {
    setSecurityHeaders(res);
    res.writeHead(500, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': CORS_ORIGIN,
    });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * GET /api/resources/{encodedUri} — Legge una resource MCP specifica.
 */
/**
 * POST /api/send-message — Invia un messaggio in un canale.
 *
 * Body JSON: { channel: string, content: string, sender: string }
 * Usa getChannelByName per risolvere il nome canale → ID, poi sendMessage.
 * Broadcast evento SSE dopo l'invio via EventBus.emit().
 */
async function handleSendMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // ── Auth check ──────────────────────────────
  if (!checkAuth(req, res)) return;

  try {
    // Leggi il body JSON
    const buffers: Buffer[] = [];
    for await (const chunk of req) {
      buffers.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(buffers).toString('utf-8'));

    const { channel, content, sender } = body;

    if (!channel || !content || !sender) {
      setSecurityHeaders(res);
      res.writeHead(400, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': CORS_ORIGIN,
      });
      res.end(JSON.stringify({ error: 'Missing required fields: channel, content, sender' }));
      return;
    }

    // Import dinamici per evitare circular dependencies
    const { getChannelByName } = await import('../messaging/db-channels.js');
    const { sendMessage } = await import('../messaging/db-messages.js');

    // Risolvi nome canale → ID
    const channelRecord = getChannelByName(channel);
    if (!channelRecord) {
      setSecurityHeaders(res);
      res.writeHead(404, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': CORS_ORIGIN,
      });
      res.end(JSON.stringify({ error: `Channel '${channel}' not found` }));
      return;
    }

    // Invia il messaggio
    const message = sendMessage(channelRecord.id, sender, content);

    // Broadcast evento SSE
    emit({
      type: 'message_sent',
      channel_id: channelRecord.id,
      agent_name: sender,
      payload: message as unknown as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    });

    setSecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': CORS_ORIGIN,
    });
    res.end(JSON.stringify({ success: true, message }));
  } catch (err) {
    setSecurityHeaders(res);
    res.writeHead(500, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': CORS_ORIGIN,
    });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}


async function handleResourceRead(res: http.ServerResponse, resourceUri: string): Promise<void> {
  try {
    const { resolveResource } = await import('../resources/index.js');
    const contents = await resolveResource(resourceUri);
    setSecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': CORS_ORIGIN,
    });
    res.end(JSON.stringify({ uri: resourceUri, contents }));
  } catch (err) {
    setSecurityHeaders(res);
    res.writeHead(404, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': CORS_ORIGIN,
    });
    res.end(JSON.stringify({ error: (err as Error).message, uri: resourceUri }));
  }
}

// ---------------------------------------------------------------------------
// SSE connection handling
// ---------------------------------------------------------------------------

/**
 * Gestisce una nuova connessione SSE.
 *
 * Setup:
 * 1. Imposta header SSE + CORS
 * 2. Invia evento `connected` di conferma
 * 3. Sottoscrive EventBus per ricevere eventi
 * 4. Avvia keepalive periodico
 * 5. Avvia idle timeout (5 min)
 *
 * Cleanup:
 * - req.on('close') → rimuove subscription e pulisce risorse
 */
function handleSseConnection(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  agentFilter?: string,
  sinceId?: string
): void {
  // ── Limite connessioni ───────────────────────
  if (connections.size >= MAX_CONNECTIONS) {
    setSecurityHeaders(res);
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Too many connections. Maximum: ' + MAX_CONNECTIONS);
    console.error(`[sse-server] Connection rejected — max ${MAX_CONNECTIONS} reached`);
    return;
  }

  // ── Header SSE ────────────────────────────────
  setSecurityHeaders(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'X-Accel-Buffering': 'no', // Disabilita buffering nginx
  });

  // ── Crea stato connessione ────────────────────
  const connId = `conn_${++connectionIdCounter}`;
  const now = Date.now();

  // Sottoscrivi EventBus per tutti gli eventi
  const unsubscribe = subscribe((event: MessagingEvent) => {
    sendEventToConnection(connId, event);
  });

  // Idle timeout
  const idleTimer = setTimeout(() => {
    const conn = connections.get(connId);
    if (conn) {
      console.error(`[sse-server] Connection '${connId}' timed out (idle > ${CONNECTION_IDLE_TIMEOUT_MS / 1000}s)`);
      closeConnection(connId, conn, 'idle_timeout');
    }
  }, CONNECTION_IDLE_TIMEOUT_MS);

  const connection: SseConnection = {
    id: connId,
    res,
    agentFilter,
    connectedAt: now,
    lastActivity: now,
    unsubscribe,
    idleTimer,
  };

  connections.set(connId, connection);

  // ── Invia evento connected ──────────────────
  sendSseMessage(connection, 'connected', {
    connection_id: connId,
    agent: agentFilter ?? '*',
    connected_at: new Date(now).toISOString(),
    active_connections: connections.size,
  });

  console.error(
    `[sse-server] Client connected: '${connId}'` +
    (agentFilter ? ` (filter: agent=${agentFilter})` : ' (all events)') +
    ` | ${connections.size}/${MAX_CONNECTIONS} connections`
  );

  // ── Replay eventi passati (se sinceId specificato) ──
  if (sinceId) {
    const lastId = parseInt(sinceId, 10);
    if (!isNaN(lastId) && lastId > 0) {
      replayEvents(connection, lastId);
    }
  }


  // ── Cleanup on disconnect ─────────────────────
  req.on('close', () => {
    const conn = connections.get(connId);
    if (conn) {
      closeConnection(connId, conn, 'client_disconnect');
    }
  });

  // ── Error handling ────────────────────────────
  res.on('error', (err: Error) => {
    const conn = connections.get(connId);
    if (conn) {
      console.error(`[sse-server] Connection '${connId}' error:`, err.message);
      closeConnection(connId, conn, 'connection_error');
    }
  });
}

// ---------------------------------------------------------------------------
// Send event to connection
// ---------------------------------------------------------------------------

/**
 * Invia un evento EventBus a una connessione SSE specifica.
 * Applica il filtro agente se presente sulla connessione.
 * Gestisce backpressure: buffer > 100KB → droppa connessione.
 *
 * @param connId - ID della connessione
 * @param event - Evento da inoltrare
 */
function sendEventToConnection(connId: string, event: MessagingEvent): void {
  const conn = connections.get(connId);
  if (!conn) return;

  // Applica filtro agente
  if (conn.agentFilter && event.agent_name !== conn.agentFilter) {
    return;
  }

  // Backpressure: se il buffer write supera 100KB, droppa connessione
  const bufferSize = conn.res.writableLength;
  if (bufferSize > MAX_WRITE_BUFFER_SIZE) {
    console.error(
      `[sse-server] Backpressure: connection '${connId}' buffer ${bufferSize}B > ${MAX_WRITE_BUFFER_SIZE}B — dropping`
    );
    closeConnection(connId, conn, 'backpressure');
    return;
  }

  // Invia evento SSE
  sendSseMessage(conn, event.type, {
    type: event.type,
    payload: event.payload,
    timestamp: event.timestamp,
    channel_id: event.channel_id,
    agent_name: event.agent_name,
  });

  // Aggiorna attività (resetta idle timeout)
  conn.lastActivity = Date.now();
  clearTimeout(conn.idleTimer);
  conn.idleTimer = setTimeout(() => {
    const c = connections.get(connId);
    if (c) {
      closeConnection(connId, c, 'idle_timeout');
    }
  }, CONNECTION_IDLE_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Send SSE message (raw format)
// ---------------------------------------------------------------------------

/**
 * Scrive un messaggio in formato SSE standard sul response stream.
 *
 * Formato:
 * ```
 * event: {eventType}
 * data: {jsonData}
 *
 * ```
 *
 * @param conn - Connessione SSE
 * @param eventType - Nome dell'evento SSE
 * @param data - Dati JSON da inviare
 */
function sendSseMessage(conn: SseConnection, eventType: string, data: unknown): void {
  try {
    const payload = [
      `event: ${eventType}`,
      `data: ${JSON.stringify(data)}`,
      '',
      '',
    ].join('\n');

    conn.res.write(payload);
  } catch (err) {
    console.error(`[sse-server] Error writing to connection '${conn.id}':`, err);
  }

}
/**
 * Replica eventi passati da event_log per una nuova connessione SSE.
 * Legge eventi con id > lastEventId dal database e li invia alla connessione.
 * Usa import() dinamico per evitare dipendenze circolari (server.ts importa event-bus.ts).
 *
 * @param conn - Connessione SSE
 * @param lastEventId - ID ultimo evento ricevuto dal client
 */
function replayEvents(conn: SseConnection, lastEventId: number): void {
  try {
    // Import dinamico per evitare dipendenze circolari
    import('../core/database.js').then(({ getDatabase }) => {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT id, event_type, payload, channel_id, agent_name, event_timestamp
        FROM event_log
        WHERE id > ?
        ORDER BY id ASC
        LIMIT 500
      `).all(lastEventId) as Array<{
        id: number;
        event_type: string;
        payload: string;
        channel_id: string | null;
        agent_name: string | null;
        event_timestamp: string;
      }>;

      let replayedCount = 0;
      for (const row of rows) {
        // Applica filtro agente se presente sulla connessione
        if (conn.agentFilter && row.agent_name !== conn.agentFilter) continue;

        sendSseMessage(conn, row.event_type, {
          id: row.id,
          type: row.event_type,
          payload: JSON.parse(row.payload),
          timestamp: row.event_timestamp,
          channel_id: row.channel_id ?? undefined,
          agent_name: row.agent_name ?? undefined,
          replay: true, // Flag per distinguere eventi replay da live
        });
        replayedCount++;
      }

      console.error(
        `[sse-server] Replayed ${replayedCount} events to '${conn.id}' (since id ${lastEventId})`
      );
    }).catch((err) => {
      // DB non disponibile — skip replay (non bloccante)
      console.error('[sse-server] Replay unavailable:', err);
    });
  } catch (err) {
    console.error('[sse-server] Replay error:', err);
  }
}

/**
 * Invia un keepalive SSE a TUTTE le connessioni attive.
 * Il keepalive mantiene viva la connessione TCP attraverso proxy/load balancer
 * che potrebbero chiudere connessioni inattive.
 */
function broadcastKeepalive(): void {
  const timestamp = new Date().toISOString();
  for (const [id, conn] of connections) {
    try {
      conn.res.write(`: keepalive ${timestamp}\n\n`);
    } catch {
      // Se c'è errore, rimuoviamo la connessione
      closeConnection(id, conn, 'keepalive_error');
    }
  }
}

// ---------------------------------------------------------------------------
// Connection cleanup
// ---------------------------------------------------------------------------

/**
 * Chiude una connessione SSE e pulisce tutte le risorse associate.
 *
 * @param connId - ID connessione
 * @param conn - Oggetto connessione
 * @param reason - Motivo della chiusura (per logging)
 */
function closeConnection(
  connId: string,
  conn: SseConnection,
  reason: string
): void {
  // Rimuovi dalla mappa (se non già rimosso)
  connections.delete(connId);

  // Pulisci subscription EventBus
  try {
    conn.unsubscribe();
  } catch {
    // Ignora errori during cleanup
  }

  // Pulisci idle timer
  clearTimeout(conn.idleTimer);

  // Chiudi response stream
  try {
    conn.res.end();
  } catch {
    // Ignora errori durante end()
  }

  console.error(
    `[sse-server] Connection closed: '${connId}' (reason: ${reason})` +
    ` | ${connections.size}/${MAX_CONNECTIONS} remaining`
  );
}

// ---------------------------------------------------------------------------
// Keepalive broadcast (avviato da startSseServer)
// ---------------------------------------------------------------------------

/** Timer per keepalive periodico */
/** Funzione stop per TTL timer */
let ttlTimerStop: (() => void) | null = null;

let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Avvia il broadcast periodico di keepalive SSE (30s).
 */
function startKeepalive(): void {
  if (keepaliveTimer) return;
  keepaliveTimer = setInterval(broadcastKeepalive, KEEPALIVE_INTERVAL_MS);
}

/**
 * Ferma il broadcast periodico di keepalive.
 */
function stopKeepalive(): void {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

/**
 * Override interno per avviare il keepalive.
 * Chiamato da startSseServer dopo che il server è in ascolto.
 */
const originalStart = startSseServer;

// Re-export con keepalive avviato
export { startKeepalive, stopKeepalive };

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Formatta secondi in stringa leggibile (es. "2h 15m 30s").
 */
function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}
