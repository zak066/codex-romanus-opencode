/**
 * ComfyClient — Adapter per l'API REST di ComfyUI.
 *
 * Pattern: Adapter (thin layer che traduce chiamate MCP in richieste HTTP
 * verso l'API REST di ComfyUI).
 *
 * Tutti i metodi lanciano errori tipizzati della gerarchia ImagoError:
 * - ComfyUIConnectionError: errori di rete / connessione
 * - ComfyUIRequestError: errori HTTP (status non-2xx, timeout)
 */

import { randomUUID } from 'node:crypto';

import { debug as logDebug } from '../utils/logger.js';
import { ComfyUIConnectionError, ComfyUIRequestError } from '../utils/errors.js';

import type {
  HistoryResponse,
  ObjectInfoResponse,
  PromptResponse,
  QueueResponse,
  SystemStats,
  WorkflowNode,
} from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Timeout predefinito per ogni richiesta HTTP (30 secondi). */
const DEFAULT_TIMEOUT_MS = 30_000;

// ─── Response Type Discriminant ──────────────────────────────────────────────

type ResponseKind = 'json' | 'arraybuffer' | 'void';

// ─── ComfyClient ─────────────────────────────────────────────────────────────

export class ComfyClient {
  private readonly _baseUrl: string;
  private readonly _clientId: string;

  /**
   * @param baseUrl  URL base di ComfyUI (es. `http://127.0.0.1:8188`).
   *                 Il trailing slash viene rimosso automaticamente.
   * @param clientId UUID opzionale per identificare il client.
   *                 Se omesso, viene generato automaticamente.
   */
  constructor(baseUrl: string, clientId?: string) {
    this._baseUrl = baseUrl.replace(/\/+$/, '');
    this._clientId = clientId ?? randomUUID();
  }

  // ─── Public Properties ─────────────────────────────────────────────────────

  /** URL base di ComfyUI (senza trailing slash). */
  get baseUrl(): string {
    return this._baseUrl;
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Esegue una richiesta HTTP verso l'API di ComfyUI.
   *
   * @param method  Metodo HTTP (GET, POST, …)
   * @param path    Path relativo (es. `/prompt`, `/history/{id}`)
   * @param options Opzioni aggiuntive (body, responseType)
   * @returns       Risposta tipizzata
   */
  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      responseKind?: ResponseKind;
    },
  ): Promise<T> {
    const url = new URL(path, this._baseUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const fetchOptions: RequestInit = {
      method,
      signal: controller.signal,
      headers: {},
    };

    if (options?.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body);
      (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }

    const responseKind = options?.responseKind ?? 'json';

    try {
      logDebug('ComfyUI request', {
        method,
        url: url.toString(),
        responseKind,
      });

      const response = await fetch(url.toString(), fetchOptions);

      // Timeout disinnescato — la richiesta è completata
      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const snippet = body ? ` — ${body.slice(0, 200)}` : '';
        throw new ComfyUIRequestError(
          `ComfyUI request failed: ${response.status} ${response.statusText}${snippet}`,
          response.status,
        );
      }

      switch (responseKind) {
        case 'arraybuffer':
          return (await response.arrayBuffer()) as T;
        case 'void':
          // Consuma il body per rilasciare la connessione, poi ritorna void
          await response.text().catch(() => {});
          return undefined as T;
        default:
          return (await response.json()) as T;
      }
    } catch (err) {
      // Timeout disinnescato anche in caso di errore
      clearTimeout(timeoutId);

      // Re-throw degli errori già tipizzati
      if (err instanceof ComfyUIRequestError) {
        throw err;
      }

      // Timeout scaduto
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ComfyUIRequestError(
          `ComfyUI request timed out after ${DEFAULT_TIMEOUT_MS}ms: ${method} ${path}`,
          504,
        );
      }

      // Errori di rete / connessione
      throw new ComfyUIConnectionError(
        `Failed to connect to ComfyUI at ${this._baseUrl}: ${(err as Error).message}`,
        err,
      );
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * POST /prompt — Accoda un workflow per l'esecuzione.
   *
   * @param workflow  Mappa dei nodi del workflow (key → WorkflowNode)
   * @param extraData Dati extra opzionali da passare al prompt
   * @returns         PromptResponse con prompt_id, number e eventuali node_errors
   */
  async queuePrompt(
    workflow: Record<string, WorkflowNode>,
    extraData?: Record<string, unknown>,
  ): Promise<PromptResponse> {
    return this.request<PromptResponse>('POST', '/prompt', {
      body: {
        prompt: workflow,
        client_id: this._clientId,
        extra_data: extraData,
      },
    });
  }

  /**
   * GET /history/{promptId} — Recupera la history di un prompt completato.
   *
   * NOTA: Se il promptId non è ancora stato processato, ComfyUI ritorna `{}`.
   *       Questo NON è un errore — il chiamante deve gestire il caso di history vuota.
   *
   * @param promptId ID del prompt da recuperare
   * @returns        HistoryResponse (dict con promptId come chiave)
   */
  async getHistory(promptId: string): Promise<HistoryResponse> {
    return this.request<HistoryResponse>('GET', `/history/${encodeURIComponent(promptId)}`);
  }

  /**
   * GET /view — Recupera un file (immagine, video, etc.) da ComfyUI.
   *
   * @param filename  Nome del file
   * @param subfolder Sottocartella (può essere vuota)
   * @param type      Tipo di storage ('output' | 'input' | 'temp')
   * @returns         ArrayBuffer con i bytes del file
   */
  async getView(filename: string, subfolder: string, type: string): Promise<ArrayBuffer> {
    const params = new URLSearchParams({ filename, subfolder, type });
    return this.request<ArrayBuffer>('GET', `/view?${params.toString()}`, {
      responseKind: 'arraybuffer',
    });
  }

  /**
   * GET /system_stats — Recupera statistiche di sistema (GPU, VRAM, OS).
   */
  async getSystemStats(): Promise<SystemStats> {
    return this.request<SystemStats>('GET', '/system_stats');
  }

  /**
   * GET /queue — Recupera lo stato corrente della coda di esecuzione.
   */
  async getQueue(): Promise<QueueResponse> {
    return this.request<QueueResponse>('GET', '/queue');
  }

  /**
   * POST /queue — Cancella un job dalla coda.
   *
   * @param promptId ID del prompt da cancellare
   */
  async cancelJob(promptId: string): Promise<void> {
    await this.request<void>('POST', '/queue', {
      body: { action: 'delete', prompt_id: promptId },
      responseKind: 'void',
    });
  }

  /**
   * GET /object_info — Recupera le definizioni di tutti i nodi disponibili.
   */
  async getObjectInfo(): Promise<ObjectInfoResponse> {
    return this.request<ObjectInfoResponse>('GET', '/object_info');
  }

  /**
   * GET /embeddings — Recupera l'elenco degli embeddings disponibili.
   */
  async getEmbeddings(): Promise<string[]> {
    return this.request<string[]>('GET', '/embeddings');
  }

  /**
   * POST /free — Libera memoria scaricando modelli/embeddings dalla VRAM.
   *
   * @param unloadWhat Array di tipi da scaricare (default: ['models', 'loras'])
   */
  async freeMemory(unloadWhat?: string[]): Promise<void> {
    await this.request<void>('POST', '/free', {
      body: { unload_what: unloadWhat ?? ['models', 'loras'] },
      responseKind: 'void',
    });
  }
}
