import { NextResponse } from 'next/server';
import type { GraphOverviewDTO } from '@/lib/types';

const TABULARIUM_URL =
  process.env.NEXT_PUBLIC_TABULARIUM_URL || 'http://localhost:3100';

export async function GET() {
  try {
    const encoded = encodeURIComponent('tabularium://graph/overview');
    const res = await fetch(
      `${TABULARIUM_URL}/api/resources/${encoded}`,
      {
        next: { revalidate: 10 },
      },
    );
    if (!res.ok) throw new Error(`Tabularium returned ${res.status}`);
    const raw = await res.json();
    const data: GraphOverviewDTO = raw?.contents?.[0]?.text
      ? JSON.parse(raw.contents[0].text)
      : raw;
    return NextResponse.json(data);
  } catch (error) {
    console.error('/api/graph error:', error);
    // Fallback: empty graph
    const fallback: GraphOverviewDTO = {
      total_edges: 0,
      by_entity_type: {},
      by_relation: {},
      last_updated: new Date().toISOString(),
      nodes: [],
      edges: [],
    };
    return NextResponse.json(fallback);
  }
}
