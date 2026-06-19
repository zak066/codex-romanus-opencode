import { requireAuth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { propagateModelChange, type PropagationResult } from '@/lib/propagation';

export async function POST(request: Request) {
  // Require authentication
  const auth = requireAuth(request);
  if (!auth.authorized) return auth.error ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { agentName, updates } = body as {
      agentName?: string;
      updates?: Record<string, unknown>;
    };

    if (!agentName || !updates) {
      return NextResponse.json(
        { error: 'agentName and updates are required' },
        { status: 400 },
      );
    }

    const configPath = path.resolve(process.cwd(), '..', 'opencode.json');
    const raw = await readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);

    // Support multiple possible structures
    const agents = config.agent || config.agents || config.agentConfigs;

    if (!agents || !agents[agentName]) {
      return NextResponse.json(
        { error: `Agent '${agentName}' not found` },
        { status: 404 },
      );
    }

    // Apply updates to the agent config
    Object.assign(agents[agentName], updates);

    // Write back to disk
    const targetKey = config.agent ? 'agent' : config.agents ? 'agents' : 'agentConfigs';
    config[targetKey] = agents;
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // Propaga il cambio modello anche al file .md dell'agente (best-effort)
    let propagationResult: PropagationResult | undefined;
    if (updates.model && typeof updates.model === 'string') {
      propagationResult = await propagateModelChange(
        agentName,
        updates.model,
      );
      if (!propagationResult.success) {
        console.warn(
          `Propagazione .md fallita per ${agentName}:`,
          propagationResult.error,
        );
      }
    }

    return NextResponse.json({
      success: true,
      agent: agents[agentName],
      ...(propagationResult ? { propagation: propagationResult } : {}),
    });
  } catch (error) {
    console.error('Failed to update config:', error);
    return NextResponse.json(
      { error: 'Failed to update config' },
      { status: 500 },
    );
  }
}
