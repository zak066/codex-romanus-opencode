/**
 * AssetRegistry — Registro asset in-memory con TTL e dual-index.
 *
 * Traccia le immagini generate da ComfyUI usando una stable identity
 * (filename:subfolder:type) conforme a ADR-023.
 *
 * Pattern: In-memory Registry con lookup duale (UUID + identity key).
 * Access tracking: ogni get/getByIdentity incrementa accessCount.
 * Expiry: cleanup manuale via cleanupExpired() — mai automatico.
 * Eviction: LRU-like quando si raggiunge maxSize.
 */

import { randomUUID } from 'node:crypto';

import type { AssetIdentity } from '../comfyui/types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 ore
const DEFAULT_MAX_SIZE = 1000;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface AssetInfo {
  filename: string;
  subfolder: string;
  type: 'output' | 'input' | 'temp';
  mimeType?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  promptId?: string;
}

export interface Provenance {
  workflowId?: string;
  promptId?: string;
  workflowJson?: unknown;
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  modelName?: string;
  createdAt: Date;
}

export interface Asset {
  id: string;
  identity: AssetIdentity;
  provenance?: Provenance;
  createdAt: Date;
  expiresAt: Date;
  accessCount: number;
  lastAccessed: Date;
}

export interface AssetFilter {
  type?: string;
  promptId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}

export interface AssetMetadata {
  id: string;
  identity: AssetIdentity;
  age: number;          // ms since creation
  ttlRemaining: number; // ms until expiry
  accessCount: number;
  provenance?: {
    promptId?: string;
    prompt?: string;
    modelName?: string;
    seed?: number;
  };
}

export interface RegistryStats {
  totalAssets: number;
  expiredCount: number;
  activeCount: number;
  oldestAsset: string | null;
  newestAsset: string | null;
  memoryEstimate: string; // "~X KB"
  ttlMs: number;
  maxSize: number;
}

// ─── AssetRegistry ───────────────────────────────────────────────────────────

export class AssetRegistry {
  private readonly _assets: Map<string, Asset>;
  private readonly _identityIndex: Map<string, string>;
  private readonly _ttlMs: number;
  private readonly _maxSize: number;

  /**
   * @param options.ttlMs  Durata TTL in ms (default: 24h)
   * @param options.maxSize  Numero massimo di asset (default: 1000)
   */
  constructor(options?: { ttlMs?: number; maxSize?: number }) {
    this._assets = new Map();
    this._identityIndex = new Map();
    this._ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    this._maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Registra un nuovo asset nel registro.
   *
   * Se il registro ha raggiunto maxSize, rimuove l'asset più vecchio
   * (per createdAt) prima di registrare il nuovo.
   *
   * @param info        Dati dell'asset (filename, subfolder, type, …)
   * @param provenance  Metadati di provenienza opzionali
   * @returns           Asset registrato con UUID, timestamps e accessCount=0
   */
  registerAsset(info: AssetInfo, provenance?: Provenance): Asset {
    if (this._assets.size >= this._maxSize) {
      this._evictOldest();
    }

    const now = new Date();
    const identity: AssetIdentity = {
      filename: info.filename,
      subfolder: info.subfolder,
      type: info.type,
    };

    const asset: Asset = {
      id: randomUUID(),
      identity,
      provenance,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this._ttlMs),
      accessCount: 0,
      lastAccessed: now,
    };

    const identityKey = this._toIdentityKey(asset.identity);

    this._assets.set(asset.id, asset);
    this._identityIndex.set(identityKey, asset.id);

    return asset;
  }

  /**
   * Recupera un asset per UUID.
   * Incrementa accessCount e aggiorna lastAccessed.
   *
   * @param assetId  UUID dell'asset
   * @returns        Asset se trovato, null altrimenti
   */
  getAsset(assetId: string): Asset | null {
    const asset = this._assets.get(assetId);
    if (!asset) return null;

    asset.accessCount++;
    asset.lastAccessed = new Date();

    return asset;
  }

  /**
   * Recupera un asset per stable identity (filename:subfolder:type).
   * Incrementa accessCount e aggiorna lastAccessed.
   *
   * @param identity  Tripletta stable identity (case-sensitive)
   * @returns         Asset se trovato, null altrimenti
   */
  getAssetByIdentity(identity: AssetIdentity): Asset | null {
    const identityKey = this._toIdentityKey(identity);
    const assetId = this._identityIndex.get(identityKey);
    if (!assetId) return null;

    return this.getAsset(assetId);
  }

  /**
   * Elenca gli asset con filtri opzionali.
   * Ordinati per createdAt discendente (più recente primo).
   *
   * @param filter  Filtri opzionali (type, promptId, since, until, limit)
   * @returns       Array di asset filtrati e ordinati
   */
  listAssets(filter?: AssetFilter): Asset[] {
    const all = Array.from(this._assets.values());

    const filtered = all.filter((asset) => {
      if (filter?.type !== undefined && asset.identity.type !== filter.type) {
        return false;
      }
      if (filter?.promptId !== undefined && asset.provenance?.promptId !== filter.promptId) {
        return false;
      }
      if (filter?.since !== undefined && asset.createdAt < filter.since) {
        return false;
      }
      if (filter?.until !== undefined && asset.createdAt > filter.until) {
        return false;
      }
      return true;
    });

    // Ordinamento per createdAt discendente
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (filter?.limit !== undefined && filter.limit > 0) {
      return filtered.slice(0, filter.limit);
    }

    return filtered;
  }

  /**
   * Recupera i metadati di un asset (senza modificare accessCount).
   *
   * @param assetId  UUID dell'asset
   * @returns        AssetMetadata se trovato, null altrimenti
   */
  getAssetMetadata(assetId: string): AssetMetadata | null {
    const asset = this._assets.get(assetId);
    if (!asset) return null;

    const now = Date.now();
    const age = now - asset.createdAt.getTime();
    const ttlRemaining = Math.max(0, asset.expiresAt.getTime() - now);

    return {
      id: asset.id,
      identity: { ...asset.identity },
      age,
      ttlRemaining,
      accessCount: asset.accessCount,
      provenance: asset.provenance
        ? {
            promptId: asset.provenance.promptId,
            prompt: asset.provenance.prompt,
            modelName: asset.provenance.modelName,
            seed: asset.provenance.seed,
          }
        : undefined,
    };
  }

  /**
   * Rimuove tutti gli asset scaduti (expiresAt <= now).
   *
   * NOTA: la rimozione NON è automatica — va chiamata esplicitamente.
   *
   * @returns  Numero di asset rimossi
   */
  cleanupExpired(): number {
    const now = Date.now();
    let removedCount = 0;

    for (const [id, asset] of this._assets) {
      if (asset.expiresAt.getTime() <= now) {
        this._assets.delete(id);
        this._identityIndex.delete(this._toIdentityKey(asset.identity));
        removedCount++;
      }
    }

    return removedCount;
  }

  /**
   * Statistiche correnti del registro.
   *
   * La stima di memoria conta approssimativamente i byte delle stringhe
   * nelle mappe (UUID, filename, subfolder, identityKey).
   *
   * @returns  RegistryStats
   */
  getStats(): RegistryStats {
    const now = Date.now();
    let expiredCount = 0;
    let oldestAssetId: string | null = null;
    let newestAssetId: string | null = null;
    let oldestTime = Infinity;
    let newestTime = 0;

    for (const [id, asset] of this._assets) {
      if (asset.expiresAt.getTime() <= now) {
        expiredCount++;
      }

      const created = asset.createdAt.getTime();
      if (created < oldestTime) {
        oldestTime = created;
        oldestAssetId = id;
      }
      if (created > newestTime) {
        newestTime = created;
        newestAssetId = id;
      }
    }

    // Stima approssimativa della memoria (solo stringhe nelle mappe)
    let totalBytes = 0;
    for (const [id, asset] of this._assets) {
      totalBytes += id.length * 2;
      totalBytes += asset.identity.filename.length * 2;
      totalBytes += asset.identity.subfolder.length * 2;
      totalBytes += this._toIdentityKey(asset.identity).length * 2;
    }
    const memoryEstimateKb = Math.max(1, Math.round(totalBytes / 1024));

    return {
      totalAssets: this._assets.size,
      expiredCount,
      activeCount: this._assets.size - expiredCount,
      oldestAsset: oldestAssetId,
      newestAsset: newestAssetId,
      memoryEstimate: `~${memoryEstimateKb} KB`,
      ttlMs: this._ttlMs,
      maxSize: this._maxSize,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Costruisce una chiave stabile per l'indice delle identity.
   * Formato: "filename:subfolder:type" (case-sensitive).
   */
  private _toIdentityKey(identity: AssetIdentity): string {
    return `${identity.filename}:${identity.subfolder}:${identity.type}`;
  }

  /**
   * Rimuove l'asset più vecchio (per createdAt) dal registro.
   * Usato quando si raggiunge maxSize in registerAsset().
   */
  private _evictOldest(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, asset] of this._assets) {
      if (asset.createdAt.getTime() < oldestTime) {
        oldestTime = asset.createdAt.getTime();
        oldestId = id;
      }
    }

    if (oldestId) {
      const asset = this._assets.get(oldestId)!;
      this._assets.delete(oldestId);
      this._identityIndex.delete(this._toIdentityKey(asset.identity));
    }
  }
}
