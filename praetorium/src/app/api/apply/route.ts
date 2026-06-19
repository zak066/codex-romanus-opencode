import { requireAuth } from '@/lib/auth';

import { NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

export async function POST(request: Request) {
  // Require authentication
  const auth = requireAuth(request);
  if (!auth.authorized) return auth.error;


  try {
    const body = await request.json();
    const { config: newConfig } = body as {
      config?: Record<string, unknown> | string;
    };

    if (!newConfig) {
      return NextResponse.json(
        { error: 'config is required' },
        { status: 400 },
      );
    }

    const configPath = path.resolve(process.cwd(), '..', 'opencode.json');

    // Read current config
    const raw = await readFile(configPath, 'utf-8');

    // Create backup directory and write backup with timestamp
    const backupDir = path.resolve(process.cwd(), '..', 'backups');
    await mkdir(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `opencode-${timestamp}.json`);
    await writeFile(backupPath, raw, 'utf-8');

    // Write new config
    const newConfigStr =
      typeof newConfig === 'string'
        ? newConfig
        : JSON.stringify(newConfig, null, 2);
    await writeFile(configPath, newConfigStr, 'utf-8');

    return NextResponse.json({
      success: true,
      backupPath: backupPath.replace(process.cwd() + '/..', '..'),
      timestamp,
    });
  } catch (error) {
    console.error('Failed to apply config:', error);
    return NextResponse.json(
      { error: 'Failed to apply config' },
      { status: 500 },
    );
  }
}
