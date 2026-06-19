/**
 * API route: /api/package/profile
 * GET  → elenca profili
 * POST → crea nuovo profilo
 * DELETE → rimuove profilo per id
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { PackageProfile, PackageOptions } from '@/lib/package/types';
import { DEFAULT_OPTIONS } from '@/lib/package/types';

// Salva il file dei profili nella root del progetto (codex-romanus/)
const PROFILES_PATH = join(process.cwd(), '..', '.package-profiles.json');

async function loadProfiles(): Promise<PackageProfile[]> {
  try {
    const data = await fs.readFile(PROFILES_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveProfiles(profiles: PackageProfile[]): Promise<void> {
  await fs.writeFile(PROFILES_PATH, JSON.stringify(profiles, null, 2), 'utf-8');
}

// Profilo built-in standard
const STANDARD_PROFILE: PackageProfile = {
  id: 'standard',
  name: 'Standard',
  options: { ...DEFAULT_OPTIONS },
};

const MINIMAL_PROFILE: PackageProfile = {
  id: 'minimal',
  name: 'Minimal',
  options: {
    ...DEFAULT_OPTIONS,
    servers: { ...DEFAULT_OPTIONS.servers, imago: false, nuntius: false, praetorium: false },
    includeDocs: false,
    includeTemplates: false,
    includeDist: false,
    includeFsBackup: false,
    includeAgents: false,
    includeSkills: false,
  },
};

const FULL_PROFILE: PackageProfile = {
  id: 'full',
  name: 'Full',
  options: {
    servers: {
      tabularium: true,
      ianus: true,
      speculum: true,
      praetorium: true,
      imago: true,
      nuntius: true,
    },
    presets: { large: true, medium: true, small: true },
    includeDocs: true,
    includeTemplates: true,
    includeSetup: true,
    includeDist: true,
    includeFsBackup: true,
    includeAgents: true,
    includeSkills: true,
  },
};

const BUILT_IN_PROFILES = [STANDARD_PROFILE, MINIMAL_PROFILE, FULL_PROFILE];

export async function GET() {
  const customProfiles = await loadProfiles();
  return NextResponse.json([...BUILT_IN_PROFILES, ...customProfiles], { status: 200 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.name || !body.options) {
      return NextResponse.json(
        { error: 'name e options sono obbligatori' },
        { status: 400 },
      );
    }

    const newProfile: PackageProfile = {
      id: `profile-${Date.now()}`,
      name: body.name,
      options: body.options as PackageOptions,
    };

    const profiles = await loadProfiles();
    profiles.push(newProfile);
    await saveProfiles(profiles);

    return NextResponse.json(newProfile, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: 'Errore durante la creazione del profilo' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Parametro id richiesto' }, { status: 400 });
    }

    // Non permettere eliminazione profili built-in
    if (BUILT_IN_PROFILES.some((p) => p.id === id)) {
      return NextResponse.json({ error: 'Impossibile eliminare un profilo built-in' }, { status: 400 });
    }

    const profiles = await loadProfiles();
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: `Profilo ${id} non trovato` }, { status: 404 });
    }

    profiles.splice(idx, 1);
    await saveProfiles(profiles);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Errore durante l'eliminazione del profilo" },
      { status: 500 },
    );
  }
}
