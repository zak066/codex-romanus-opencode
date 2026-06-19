import { NextResponse } from 'next/server';

const TABULARIUM_URL = process.env.NEXT_PUBLIC_TABULARIUM_URL || 'http://localhost:3100';

export async function GET() {
  try {
    const encodedUri = encodeURIComponent('tabularium://agents/status');
    const res = await fetch(`${TABULARIUM_URL}/api/resources/${encodedUri}`, {
      next: { revalidate: 5 },
    });
    if (!res.ok) throw new Error(`Tabularium returned ${res.status}`);
    const raw = await res.json();
    // Tabularium wraps data in contents[0].text
    const agentsData = raw?.contents?.[0]?.text ? JSON.parse(raw.contents[0].text) : raw;
    return NextResponse.json(agentsData);
  } catch (error) {
    // Fallback: return empty agents list
    console.error('/api/agents error:', error);
    return NextResponse.json({ total: 0, online: 0, offline: 0, agents: [] });
  }
}
