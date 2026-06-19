import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export async function POST(request: Request) {
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

    // Find the agents map
    const agentsMap = config.agent || config.agents || config.agentConfigs || {};

    if (!agentsMap[agentName]) {
      return NextResponse.json(
        { error: `Agent '${agentName}' not found` },
        { status: 404 },
      );
    }

    // Deep clone to avoid mutation
    const preview = JSON.parse(JSON.stringify(config));
    const previewAgents = preview.agent || preview.agents || preview.agentConfigs || {};
    const previewAgent = previewAgents[agentName];

    // Apply updates to preview copy
    Object.assign(previewAgent, updates);

    return NextResponse.json({
      success: true,
      preview: {
        before: agentsMap[agentName],
        after: previewAgent,
        updatedKeys: Object.keys(updates),
      },
    });
  } catch (error) {
    console.error('Preview failed:', error);
    return NextResponse.json(
      { error: 'Preview failed' },
      { status: 500 },
    );
  }
}
