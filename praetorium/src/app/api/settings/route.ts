import { NextResponse } from 'next/server';
import { readFile, writeFile, access } from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth';

const SETTINGS_FILE = 'settings.json';

async function getSettingsPath(): Promise<string> {
  return path.resolve(process.cwd(), SETTINGS_FILE);
}

export interface PraetoriumSettings {
  theme?: 'light' | 'dark' | 'system' | 'cyberpunk';
  [key: string]: unknown;
}

const DEFAULT_SETTINGS: PraetoriumSettings = {
  theme: 'system',
};

// ─── GET /api/settings ──────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Auth opzionale — lettura permessa anche senza auth per il tema al mount
  try {
    const settingsPath = await getSettingsPath();

    try {
      await access(settingsPath);
    } catch {
      // File non esiste → ritorna default
      return NextResponse.json(DEFAULT_SETTINGS);
    }

    const raw = await readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(raw) as PraetoriumSettings;

    return NextResponse.json({ ...DEFAULT_SETTINGS, ...settings });
  } catch (error) {
    console.error('Failed to read settings:', error);
    return NextResponse.json(DEFAULT_SETTINGS);
  }
}

// ─── POST /api/settings ─────────────────────────────────────────────────────

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (!auth.authorized) {
    return auth.error ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Partial<PraetoriumSettings>;
    const settingsPath = await getSettingsPath();

    let existing: PraetoriumSettings = { ...DEFAULT_SETTINGS };

    try {
      await access(settingsPath);
      const raw = await readFile(settingsPath, 'utf-8');
      existing = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      // File non esiste → usa default
    }

    // Merge delle impostazioni
    const updated: PraetoriumSettings = { ...existing, ...body };

    await writeFile(settingsPath, JSON.stringify(updated, null, 2), 'utf-8');

    return NextResponse.json({ success: true, settings: updated });
  } catch (error) {
    console.error('Failed to save settings:', error);
    return NextResponse.json(
      { error: 'Failed to save settings' },
      { status: 500 },
    );
  }
}
