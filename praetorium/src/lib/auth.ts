import { NextResponse } from 'next/server';

/**
 * Authenticate an API request using X-API-Key header.
 *
 * If PRAETORIUM_API_KEY env is NOT set, authentication is bypassed
 * (backward compatibility for local development).
 *
 * If PRAETORIUM_API_KEY IS set, the request MUST include a matching
 * X-API-Key header, otherwise a 401 response is returned.
 */
export function requireAuth(request: Request): {
  authorized: boolean;
  error?: Response;
} {
  try {
    const apiKey = process.env.PRAETORIUM_API_KEY;

    // If no key is configured, auth is disabled (dev mode)
    if (!apiKey) {
      return { authorized: true };
    }

    const providedKey = request.headers.get('X-API-Key');

    if (!providedKey || providedKey !== apiKey) {
      return {
        authorized: false,
        error: NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 },
        ),
      };
    }

    return { authorized: true };
  } catch {
    // Fail closed on unexpected errors
    return {
      authorized: false,
      error: NextResponse.json(
        { error: 'Internal authentication error' },
        { status: 500 },
      ),
    };
  }
}
