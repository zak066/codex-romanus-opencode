import { NextResponse } from 'next/server';

const TABULARIUM_URL = process.env.NEXT_PUBLIC_TABULARIUM_URL || 'http://localhost:3100';

export async function GET() {
  try {
    const encodedUri = encodeURIComponent('tabularium://quality/scorecard');
    const res = await fetch(`${TABULARIUM_URL}/api/resources/${encodedUri}`, {
      next: { revalidate: 10 },
    });
    if (!res.ok) throw new Error(`Tabularium returned ${res.status}`);
    const raw = await res.json();
    const qualityData = raw?.contents?.[0]?.text ? JSON.parse(raw.contents[0].text) : raw;
    return NextResponse.json(qualityData);
  } catch (error) {
    console.error('/api/quality error:', error);
    return NextResponse.json({
      grade: 'N/A',
      score: 0,
      generatedAt: new Date().toISOString(),
      window_days: 7,
      period: { from: '', to: '' },
      components: [],
    });
  }
}
