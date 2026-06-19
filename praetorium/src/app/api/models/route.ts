import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    const configPath = path.resolve(process.cwd(), '..', 'opencode.json');
    const raw = await readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);

    // Support multiple possible structures (agent, agents, agentConfigs)
    const agentsMap = config.agent || config.agents || config.agentConfigs || {};

    // Filter only Codex Romanus agents (exclude OpenCode built-in agents)
    const CODEX_AGENTS = new Set([
      'iuppiter-orchestrator', 'minerva-architect', 'vulcanus-senior-dev',
      'catone-quality', 'janus-security', 'agrippa-devops',
      'scipione-perf', 'ovidio-frontend', 'plinioilvecchio-seo',
      'mercurius-junior-dev', 'diana-tester', 'tacito-docs',
    ]);

    const agents = Object.entries(agentsMap)
      .filter(([name]) => CODEX_AGENTS.has(name))
      .map(([name, agentConfig]) => ({
        name,
        ...(agentConfig as Record<string, unknown>),
      }));

    return NextResponse.json({ agents });
  } catch (error) {
    console.error('Failed to load models:', error);
    return NextResponse.json(
      { error: 'Failed to load models' },
      { status: 500 },
    );
  }
}
