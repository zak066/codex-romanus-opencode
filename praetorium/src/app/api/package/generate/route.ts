/**
 * API route: POST /api/package/generate
 * Crea un archivio zip personalizzato di Codex Romanus.
 */

import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { createPackage } from '@/lib/package/packager';
import { DEFAULT_OPTIONS, type PackageOptions, type PackageHistoryEntry } from '@/lib/package/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json(
        { error: 'Il corpo della richiesta non può essere vuoto' },
        { status: 400 },
      );
    }

    // Merge con default
    const options: PackageOptions = {
      servers: {
        tabularium: body.servers?.tabularium ?? DEFAULT_OPTIONS.servers.tabularium,
        ianus: body.servers?.ianus ?? DEFAULT_OPTIONS.servers.ianus,
        speculum: body.servers?.speculum ?? DEFAULT_OPTIONS.servers.speculum,
        praetorium: body.servers?.praetorium ?? DEFAULT_OPTIONS.servers.praetorium,
        imago: body.servers?.imago ?? DEFAULT_OPTIONS.servers.imago,
        nuntius: body.servers?.nuntius ?? DEFAULT_OPTIONS.servers.nuntius,
      },
      presets: {
        large: body.presets?.large ?? DEFAULT_OPTIONS.presets.large,
        medium: body.presets?.medium ?? DEFAULT_OPTIONS.presets.medium,
        small: body.presets?.small ?? DEFAULT_OPTIONS.presets.small,
      },
      includeDocs: body.includeDocs ?? DEFAULT_OPTIONS.includeDocs,
      includeTemplates: body.includeTemplates ?? DEFAULT_OPTIONS.includeTemplates,
      includeSetup: body.includeSetup ?? DEFAULT_OPTIONS.includeSetup,
      includeDist: body.includeDist ?? DEFAULT_OPTIONS.includeDist,
      includeFsBackup: body.includeFsBackup ?? DEFAULT_OPTIONS.includeFsBackup,
      includeAgents: body.includeAgents ?? DEFAULT_OPTIONS.includeAgents,
      includeSkills: body.includeSkills ?? DEFAULT_OPTIONS.includeSkills,
    };

    // La root del progetto è una livello sopra praetorium/ (codex-romanus/)
    const projectRoot = join(process.cwd(), '..');

    // Directory temporanea per l'output
    const outputDir = mkdtempSync(join(tmpdir(), 'codex-pack-'));

    const result = await createPackage(options, projectRoot, outputDir);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Errore durante la generazione' },
        { status: 500 },
      );
    }

    // --- Persistenza: salva la generazione nella cronologia ---
    try {
      const { writeFile, readFile: rf, mkdir: mkdirP } = await import('node:fs/promises');
      const pathMod = await import('node:path');

      const SERVER_CODES: Record<string, string> = {
        tabularium: 'T', ianus: 'I', speculum: 'S', praetorium: 'P',
        imago: 'M', nuntius: 'N',
      };

      const servers: string[] = [];
      for (const [key, code] of Object.entries(SERVER_CODES)) {
        if ((options.servers as Record<string, boolean>)[key]) servers.push(code);
      }

      const bytes = result.sizeBytes;
      const size = bytes >= 1_073_741_824
        ? `${(bytes / 1_073_741_824).toFixed(1)} GB`
        : `${(bytes / 1_048_576).toFixed(1)} MB`;

      const d = new Date(result.generatedAt);
      const date =
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

      const entry: PackageHistoryEntry = {
        date, servers, size,
        fileName: result.fileName,
        sizeBytes: bytes,
        generatedAt: result.generatedAt,
      };

      const historyFilePath = pathMod.resolve(process.cwd(), 'data', 'package-history.json');
      await mkdirP(pathMod.dirname(historyFilePath), { recursive: true });

      let history: PackageHistoryEntry[] = [];
      try {
        const existing = await rf(historyFilePath, 'utf-8');
        history = JSON.parse(existing);
        if (!Array.isArray(history)) history = [];
      } catch { /* file non esiste ancora */ }

      history.push(entry);
      await writeFile(historyFilePath, JSON.stringify(history, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist package history:', err);
      // Non bloccare il flusso principale
    }

    // Legge il file zip e lo restituisce come download
    const { readFile } = await import('node:fs/promises');
    const zipPath = join(outputDir, result.fileName);
    const zipBuffer = await readFile(zipPath);

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Content-Length': String(zipBuffer.length),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Errore: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Usa POST per generare un pacchetto' },
    { status: 405 },
  );
}
