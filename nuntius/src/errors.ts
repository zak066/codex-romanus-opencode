// Error hierarchy for Nuntius
// SocialError (base)
// ├── AuthError         → token scaduto / permessi insufficienti
// ├── RateLimitError    → rate limit esaurito (include retryAfter)
// ├── ValidationError   → input post non valido
// ├── NetworkError      → timeout / DNS / connessione
// └── PlatformError     → errore specifico piattaforma (code + message)

export class SocialError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'SocialError';
  }
}

export class AuthError extends SocialError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

export class RateLimitError extends SocialError {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
  ) {
    super(message, 'RATE_LIMIT');
    this.name = 'RateLimitError';
  }
}

export class ValidationError extends SocialError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class NetworkError extends SocialError {
  constructor(message: string, public readonly cause?: Error) {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}

export class PlatformError extends SocialError {
  constructor(message: string, public readonly platformCode?: string) {
    super(message, 'PLATFORM_ERROR');
    this.name = 'PlatformError';
  }
}
