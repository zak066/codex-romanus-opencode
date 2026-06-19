import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const ZEN_API = {
  go: 'https://opencode.ai/zen/go/v1/models',
  zen: 'https://opencode.ai/zen/v1/models',
};

const CACHE_FILE = path.resolve(process.cwd(), '..', 'arae', '.arae-cache.json');

export async function GET() {
  try {
    // Fetch parallelo da entrambe le API Zen
    const [goResult, zenResult] = await Promise.allSettled([
      fetch(ZEN_API.go).then((r) => r.json()),
      fetch(ZEN_API.zen).then((r) => r.json()),
    ]);

    const go =
      goResult.status === 'fulfilled' && Array.isArray(goResult.value?.data)
        ? goResult.value.data
            .filter((m: { id?: string }) => typeof m.id === 'string' && m.id.length > 0)
            .map((m: { id: string }) => ({ id: m.id, provider: 'go' as const }))
        : [];
    const zen =
      zenResult.status === 'fulfilled' && Array.isArray(zenResult.value?.data)
        ? zenResult.value.data
            .filter((m: { id?: string }) => typeof m.id === 'string' && m.id.length > 0)
            .map((m: { id: string }) => ({ id: m.id, provider: 'zen' as const }))
        : [];

    // Se almeno un'API ha risposto, ritorna i dati
    if (go.length > 0 || zen.length > 0) {
      return NextResponse.json({ go, zen });
    }

    // Fallback: cache locale Arae
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    return NextResponse.json(JSON.parse(raw));
  } catch {
    // Fallback finale: cache locale
    try {
      const raw = await fs.readFile(CACHE_FILE, 'utf-8');
      return NextResponse.json(JSON.parse(raw));
    } catch {
      return NextResponse.json({ go: [], zen: [] });
    }
  }
}
