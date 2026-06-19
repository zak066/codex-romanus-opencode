import { NextResponse } from 'next/server';

const TABULARIUM_URL = process.env.NEXT_PUBLIC_TABULARIUM_URL || 'http://localhost:3100';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    let resourceUri: string;
    if (id) {
      resourceUri = `tabularium://decisions/${id}`;
    } else {
      resourceUri = 'tabularium://decisions';
    }

    const encodedUri = encodeURIComponent(resourceUri);
    const res = await fetch(`${TABULARIUM_URL}/api/resources/${encodedUri}`, {
      next: { revalidate: 10 },
    });
    if (!res.ok) throw new Error(`Tabularium returned ${res.status}`);
    const raw = await res.json();
    const data = raw?.contents?.[0]?.text ? JSON.parse(raw.contents[0].text) : raw;
    return NextResponse.json(data);
  } catch (error) {
    console.error('/api/decisions error:', error);
    return NextResponse.json(
      { total_adrs: 0, active_adrs: 0, active_details: [] },
      { status: 200 },
    );
  }
}
