import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: pathSegments } = await params;
    const baseUrl =
      process.env.NEXT_PUBLIC_TABULARIUM_URL || 'http://localhost:3100';
    const pathStr = pathSegments.join('/');
    const url = new URL(request.url);
    const queryString = url.search;
    const targetUrl = `${baseUrl}/${pathStr}${queryString}`;

    const res = await fetch(targetUrl, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('Tabularium proxy GET error:', error);
    return NextResponse.json(
      { error: 'Tabularium proxy failed' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: pathSegments } = await params;
    const baseUrl =
      process.env.NEXT_PUBLIC_TABULARIUM_URL || 'http://localhost:3100';
    const pathStr = pathSegments.join('/');
    const url = new URL(request.url);
    const queryString = url.search;
    const targetUrl = `${baseUrl}/${pathStr}${queryString}`;

    const body = await request.json();

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('Tabularium proxy POST error:', error);
    return NextResponse.json(
      { error: 'Tabularium proxy failed' },
      { status: 500 },
    );
  }
}
