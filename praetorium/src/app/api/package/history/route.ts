/**
 * API route: GET /api/package/history
 * Restituisce la cronologia dei pacchetti generati.
 */

import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import type { PackageHistoryEntry } from '@/lib/package/types';

export async function GET() {
  try {
    const historyFilePath = path.resolve(
      process.cwd(),
      'data',
      'package-history.json',
    );

    const raw = await readFile(historyFilePath, 'utf-8');
    const history: PackageHistoryEntry[] = JSON.parse(raw);

    if (!Array.isArray(history)) {
      return NextResponse.json({ history: [], total: 0 });
    }

    return NextResponse.json({
      history,
      total: history.length,
    });
  } catch {
    // File non esiste o errore di lettura → cronologia vuota
    return NextResponse.json({ history: [], total: 0 });
  }
}
