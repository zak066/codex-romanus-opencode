/**
 * core/embedder.ts
 * Astrazione per generazione di embedding vettoriali.
 *
 * Supporta due modalità:
 * 1. **Remota** (prod): chiama API esterna per embedding di alta qualità
 * 2. **Locale** (fallback): genera vettori TF-IDF-like a 384 dimensioni senza dipendenze
 *
 * Il fallback locale usa una semplice bag-of-words pesata con hashing su
 * n-gram di caratteri per produrre vettori 384-dim riproducibili.
 * Non è accurato come OpenAI/text-embedding-3-small, ma:
 *   - Funziona offline (zero dipendenze esterne)
 *   - È deterministico (stesso input → stesso vettore)
 *   - Produce risultati utili per similarità tra testi tecnici
 *
 * @module core/embedder
 */

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Dimensione del vettore embedding (allineato con standard industry) */
const VECTOR_DIMENSIONS = 384;

/** Numero di feature di n-gram (per il fallback locale) */
const NGRAM_SIZE = 3;

/**
 * Dimensione del vocabolario per feature hashing.
 * 384 dimensioni / 2 (per sym hash) = 192 feature bucket
 */
const FEATURE_BUCKETS = Math.floor(VECTOR_DIMENSIONS / 2);

// ---------------------------------------------------------------------------
// Interfaccia
// ---------------------------------------------------------------------------

export interface Embedder {
  /** Genera embedding per un singolo testo */
  embed(text: string): Promise<number[]>;

  /** Genera embedding per batch di testi */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** Il sistema è disponibile (sempre true per fallback locale) */
  readonly isAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Fallback locale — TF-IDF-like con feature hashing
// ---------------------------------------------------------------------------

/**
 * Crea un embedder locale che funziona senza dipendenze esterne.
 * Usa una combinazione di:
 *   - Feature hashing su n-gram di caratteri (sub-word)
 *   - Frequenza normalizzata (TF-like)
 *   - Lunghezza e complessità lessicale come feature aggiuntive
 *
 * Il risultato è un vettore normalizzato a norma unitaria (L2).
 */
export function createLocalEmbedder(): Embedder {
  return {
    isAvailable: true,

    async embed(text: string): Promise<number[]> {
      return embedLocal(text);
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      return texts.map((t) => embedLocal(t));
    },
  };
}

/**
 * Genera embedding locale usando feature hashing su n-gram.
 * Processo:
 * 1. Normalizza il testo (lowercase, rimuovi spazi multipli)
 * 2. Estrae n-gram di caratteri (3-gram per catturare pattern sub-word)
 * 3. Applica hashing simmetrica (hash positivo/negativo)
 * 4. Aggiunge feature lessicali (lunghezza, densità stop-words, ricchezza)
 * 5. Normalizza L2
 */
function embedLocal(text: string): number[] {
  // Normalizza
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // rimuovi punteggiatura
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    // Testo vuoto → vettore zero
    return new Array(VECTOR_DIMENSIONS).fill(0);
  }

  const words = normalized.split(/\s+/).filter(Boolean);

  // --- Feature hashing su n-gram di caratteri ---
  const vector = new Float64Array(VECTOR_DIMENSIONS);

  // Estrai n-gram di caratteri
  const ngrams = extractNgrams(normalized, NGRAM_SIZE);

  // Applica hashing simmetrica: ogni n-gram contribuisce +/- a un bucket
  for (const ng of ngrams) {
    const hash = hashString(ng);
    const bucket = Math.abs(hash) % FEATURE_BUCKETS;
    // Symmetric hash: segno determinato dal bit di segno
    const sign = hash >= 0 ? 1 : -1;
    // La dimensione totale è 2 * FEATURE_BUCKETS
    const index = sign > 0 ? bucket : bucket + FEATURE_BUCKETS;
    vector[index] += 1.0;
  }

  // --- Feature lessicali (occupano le ultime dimensioni) ---
  // Dimensione 382: densità di stop-words
  if (words.length > 0) {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
      'and', 'or', 'not', 'but', 'if', 'as', 'it', 'this', 'that',
      'il', 'di', 'la', 'lo', 'le', 'un', 'una', 'che', 'e', 'è',
    ]);
    const stopCount = words.filter((w) => stopWords.has(w)).length;
    vector[VECTOR_DIMENSIONS - 3] = stopCount / words.length;
  }

  // Dimensione 383: lunghezza media delle parole (complessità lessicale)
  const avgWordLen = words.reduce((s, w) => s + w.length, 0) / words.length;
  vector[VECTOR_DIMENSIONS - 2] = Math.min(avgWordLen / 15, 1.0); // Normalizza a [0,1]

  // Dimensione 384: densità di caratteri speciali/tecnici
  const specialChars = (normalized.match(/[0-9_\-.]/g) || []).length;
  vector[VECTOR_DIMENSIONS - 1] = Math.min(specialChars / normalized.length * 10, 1.0);

  // Normalizza L2
  return normalizeL2(Array.from(vector));
}

/**
 * Estrae tutti gli n-gram di caratteri da una stringa.
 * Include n-gram con spazi per catturare confini di parola.
 */
function extractNgrams(text: string, n: number): string[] {
  const ngrams: string[] = [];
  // Padding per catturare inizio/fine parola
  const padded = `  ${text}  `;
  for (let i = 0; i <= padded.length - n; i++) {
    ngrams.push(padded.slice(i, i + n));
  }
  return ngrams;
}

/**
 * Hash semplice di una stringa (versione stabile di djb2).
 * Garantisce che lo stesso input produca sempre lo stesso hash.
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Converti in 32-bit int
  }
  return hash;
}

/**
 * Normalizza un vettore a norma L2 unitaria.
 */
function normalizeL2(vector: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSq += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm < 1e-10) {
    return vector; // Vettore zero, evita divisione per zero
  }
  return vector.map((v) => v / norm);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Crea un embedder cercando prima API remota, poi fallback locale.
 *
 * Al momento supporta solo il fallback locale.
 * In futuro: tentare connessione a OpenAI / opencode embedding endpoint,
 * e in caso di fallimento usare createLocalEmbedder().
 *
 * @returns Embedder pronto all'uso
 */
export async function createEmbedder(): Promise<Embedder> {
  // Per ora: solo fallback locale
  // TODO Fase 4: tentare API remota (OpenAI / opencode)
  return createLocalEmbedder();
}
