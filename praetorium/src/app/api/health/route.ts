import { NextResponse } from 'next/server';

const SERVER_START_TIME = Date.now();

export async function GET() {
  const uptimeSeconds = Math.floor((Date.now() - SERVER_START_TIME) / 1000);
  return NextResponse.json({
    status: 'ok',
    startTime: new Date(SERVER_START_TIME).toISOString(),
    uptime: uptimeSeconds,
  });
}
