import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

interface TokenBucket {
  count: number;
  resetAt: number;
}

const MAX_REQUESTS = 100;
const WINDOW_MS = 60_000; // 1 minute
const CLEANUP_INTERVAL_MS = 300_000; // 5 minutes

const buckets = new Map<string, TokenBucket>();
let lastCleanup = Date.now();

function cleanupExpiredBuckets(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

  lastCleanup = now;
  for (const [ip, bucket] of buckets) {
    if (now >= bucket.resetAt) {
      buckets.delete(ip);
    }
  }
}

export function proxy(request: NextRequest): Response | undefined {
  // Only rate-limit API routes
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  try {
    cleanupExpiredBuckets();

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      '127.0.0.1';

    const now = Date.now();
    const bucket = buckets.get(ip);

    if (!bucket || now >= bucket.resetAt) {
      // New window: reset counter
      buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
      return NextResponse.next();
    }

    bucket.count += 1;

    if (bucket.count > MAX_REQUESTS) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(MAX_REQUESTS),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(bucket.resetAt / 1000)),
          },
        },
      );
    }

    return NextResponse.next();
  } catch {
    // If rate limiting fails, allow the request through
    return NextResponse.next();
  }
}

export const config = {
  matcher: '/api/:path*',
};
