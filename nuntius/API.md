# Nuntius — API Reference

> Documentazione tecnica del server MCP Nuntius per social media publishing.

---

## Tool Reference

### `social_publish`

Pubblica un post su una o più piattaforme social.

**Input Schema:**

| Parametro | Tipo | Obbligatorio | Default | Descrizione |
|-----------|------|:-----------:|:-------:|-------------|
| `platforms` | `string[]` | ✅ | — | Piattaforme target (`["facebook", "instagram"]`) |
| `text` | `string` | ✅ | — | Testo del post (max 63.206 caratteri) |
| `mediaUrls` | `string[]` | ❌ | — | URLs di media hosted pubblicamente |
| `scheduledAt` | `string` (ISO 8601) | ❌ | — | Data programmata (v2) |
| `platformSpecific` | `object` | ❌ | `{}` | Parametri specifici per piattaforma |

**Parametri `platformSpecific` supportati:**

| Piattaforma | Parametro | Tipo | Descrizione |
|-------------|-----------|------|-------------|
| facebook | `link` | `string` | URL da allegare al post |
| facebook | `published` | `boolean` | `false` per salvare come bozza |
| facebook | `noStory` | `boolean` | `true` per non pubblicare nella storia |
| instagram | `mediaType` | `string` | `IMAGE`, `VIDEO`, `REELS`, `STORIES`, `CAROUSEL` |

**Output:**
```
📤 Post published on 2 platform(s):

[facebook] ID: 123456789_987654321
  Status: published ✅
  URL: https://facebook.com/...

[instagram] ID: 17898765432109876
  Status: published ✅
  URL: https://instagram.com/p/...
```

**Errori:**
- `RateLimitError` — rate limit esaurito per la piattaforma
- `ValidationError` — input non valido (testo vuoto, URL media non valida, etc.)
- `AuthError` — token mancante o scaduto
- `NetworkError` — timeout o errore di connessione
- `PlatformError` — errore specifico della piattaforma (es. formato video non supportato)

---

### `social_validate`

Valida un post senza pubblicarlo. Controlla campi obbligatori, vincoli media e rate limit.

**Input Schema:** Stessi parametri di `social_publish`.

**Output:**
```
📋 Validation results:

[facebook] ✅ Valid
  Text: OK, Media: OK (1 image)

[instagram] ⚠️ Warning
  Instagram does not support text-only posts (no mediaUrls provided)
```

---

### `social_list_platforms`

Elenca le piattaforme attualmente configurate con stato, variabili mancanti e rate limit.

**Input:** Nessuno.

**Output:**
```
📡 Available platforms:

[facebook] ✅ Configured
  Page: 123456789
  Rate limit: 142/150 remaining this hour

[instagram] ❌ Not configured
  Missing: INSTAGRAM_ACCESS_TOKEN

[linkedin] ❌ Plugin not loaded
```

---

### `social_status`

Recupera lo stato di un post già pubblicato.

**Input Schema:**

| Parametro | Tipo | Obbligatorio | Descrizione |
|-----------|------|:-----------:|-------------|
| `platform` | `string` | ✅ | Nome piattaforma (`facebook`, `instagram`) |
| `externalId` | `string` | ✅ | ID del post sulla piattaforma |

**Output:**
```
📊 Post status:

Platform: facebook
ID: 123456789_987654321
Status: published ✅
URL: https://facebook.com/...
```

---

### `social_accounts`

Elenca gli account social collegati e configurati.

**Input:** Nessuno.

**Output:**
```
👤 Connected accounts:

facebook: Page "123456789" ✅
instagram: Not configured ❌
```

---

## Plugin Architecture

### Interfaccia `SocialPlugin`

```typescript
interface SocialPlugin {
  /** Nome univoco della piattaforma (es. "facebook", "instagram") */
  getPlatformName(): string;

  /** Variabili d'ambiente richieste per il plugin */
  getRequiredConfig(): string[];

  /** Valida la configurazione runtime */
  validateConfig(config: Record<string, unknown>): ValidationResult;

  /** Pubblica un post. Media URLs devono essere hosted pubblicamente. */
  publishPost(post: PostPayload): Promise<PublishResult>;

  /** Recupera lo stato di un post pubblicato */
  getPostStatus(externalId: string): Promise<PostStatusResult>;

  /** Vincoli sui media accettati */
  getMediaConstraints(): MediaConstraints;
}
```

### Tipi Condivisi

```typescript
interface PostPayload {
  text: string;
  mediaUrls?: string[];
  scheduledAt?: string; // ISO 8601
  platformSpecific?: Record<string, unknown>;
}

interface PublishResult {
  platform: string;
  externalId: string;
  url?: string;
  status: 'published' | 'scheduled' | 'failed' | 'pending_review';
  metadata?: Record<string, unknown>;
  publishedAt: string;
}

interface MediaConstraints {
  supportedTypes: string[];
  maxFileSize?: number;
  maxFiles?: number;
  aspectRatio?: string;
  minWidth?: number;
  minHeight?: number;
}
```

---

## Error Handling

### Gerarchia Errori

```
SocialError (base)
├── AuthError           → Token scaduto / permessi insufficienti
├── RateLimitError      → Rate limit esaurito (include retryAfter)
├── ValidationError     → Input post non valido
├── NetworkError        → Timeout / DNS / connessione
└── PlatformError       → Errore specifico piattaforma (code + message)
```

### Error Mapping per Piattaforma

**Facebook:**

| Codice Errore | Tipo | Errore Nuntius |
|:-------------:|------|----------------|
| 4 | API rate limit | `RateLimitError` |
| 17 | User rate limit | `RateLimitError` |
| 32 | Page rate limit | `RateLimitError` |
| 190 | OAuth token | `AuthError` |
| 100 | Parametro invalido | `ValidationError` |
| altri | Vari | `PlatformError` |

**Instagram:**

| Codice Errore | Tipo | Errore Nuntius |
|:-------------:|------|----------------|
| 190 / 401 | Token invalido | `AuthError` |
| 9001 / 429 | Rate limit | `RateLimitError` |
| 2207026 | Formato non supportato | `ValidationError` |
| 100 | Parametro invalido | `ValidationError` |
| 9007 | Container non pronto | `PlatformError` |

---

## Rate Limiting

Nuntius implementa **Token Bucket** in-memory per ogni piattaforma.

| Piattaforma | Token | Refill | Intento |
|-------------|:-----:|:------:|---------|
| **Facebook** | 150 | ogni ora | Conservativo rispetto al limite API (200/h) |
| **Instagram** | 25 | ogni 24h | Allineato al limite documentato (25 post/24h) |

- Se il rate limit è esaurito, il tool restituisce `RateLimitError` con il tempo stimato per il prossimo token disponibile.
- I contatori sono in-memory: un restart del server li resetta.

---

## Facebook Plugin Details

### API Endpoints

| Operazione | Metodo | Endpoint |
|-----------|:------:|----------|
| Post testuale | POST | `/{page-id}/feed` |
| Post con foto | POST | `/{page-id}/photos` |
| Post con link | POST | `/{page-id}/feed` |
| Stato post | GET | `/{post-id}?fields=id,permalink_url,created_time` |

### Auth

- **Token**: Page Access Token (generato da Facebook Developer Console)
- **Permessi richiesti**: `pages_manage_posts`, `pages_read_engagement`
- **API Version**: v22.0 (configurabile via `FACEBOOK_API_VERSION`)

### Rate Limits

- 200 chiamate/ora per user token (Nuntius: 150/h conservativo)
- I codici 4, 17, 32 indicano rate limit superato

---

## Instagram Plugin Details

### Two-Step Publishing Flow

```
┌──────────────────┐     ┌────────────────────┐     ┌──────────────────┐
│  1. Create       │     │  2. Poll Status     │     │  3. Publish      │
│  Container       │────▶│  (solo per video)   │────▶│  Container       │
│                  │     │                     │     │                  │
│ POST /{ig-id}   │     │ GET /{container-id} │     │ POST /media_     │
│   /media        │     │   ?fields=          │     │   publish        │
│                  │     │   status_code       │     │                  │
└──────────────────┘     └────────────────────┘     └──────────────────┘
```

### API Endpoints

| Operazione | Metodo | Endpoint |
|-----------|:------:|----------|
| Crea container (immagine) | POST | `/{ig-user-id}/media` |
| Crea container (video) | POST | `/{ig-user-id}/media` |
| Polling stato | GET | `/{container-id}?fields=status_code` |
| Pubblica container | POST | `/{ig-user-id}/media_publish` |
| Stato media | GET | `/{media-id}?fields=id,permalink,caption` |
| Rate limit info | GET | `/{ig-user-id}/content_publishing_limit` |

### Requisiti

- **Account**: Solo Instagram Business Account (non Creator)
- **Immagine**: Solo JPEG (formato obbligatorio)
- **Video**: H.264, AAC audio, 3s-15min, aspect ratio 0.01:1 a 10:1
- **Limite**: 25 post pubblicati per 24 ore
- **Caption**: Troncata a 2.200 caratteri dall'API
- Le URL dei media devono essere hosted su server pubblico accessibile

### Video Polling

Per video e reel, il publishing richiede un polling dello stato del container:
- Intervallo: 5 secondi
- Tentativi massimi: 30 (timeout totale: 150 secondi)
- Stati: `IN_PROGRESS` → attendere, `FINISHED` → pubblicabile, `ERROR`/`EXPIRED` → fallito
- Se il container non è FINISHED entro il timeout, viene lanciato `PlatformError`

---

## Changelog

### [1.0.0] — 2026-05-29
- ✅ Release iniziale
- ✅ Facebook Plugin (post testuali, foto, link)
- ✅ Instagram Plugin (two-step flow, immagini, video)
- ✅ 5 MCP Tools: publish, validate, list_platforms, status, accounts
- ✅ Architettura a plugin modulare
- ✅ Rate Limiting (Token Bucket)
- ✅ Retry con exponential backoff
- ✅ 124 test unitari, 0 fallimenti
- ✅ 0 errori TypeScript
