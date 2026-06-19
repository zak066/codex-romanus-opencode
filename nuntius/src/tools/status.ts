// social_status tool — gets the status of a previously published post

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './index.js';

const StatusInputSchema = z.object({
  platform: z.string().min(1, { error: 'Platform name is required' }),
  externalId: z.string().min(1, { error: 'External post ID is required' }),
});

export function registerStatusTool(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'social_status',
    'Get the status of a previously published post on a specific platform',
    StatusInputSchema.shape,
    async (args) => {
      const parsed = StatusInputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }],
        };
      }

      const { platform, externalId } = parsed.data;

      try {
        const result = await ctx.publishEngine.getStatus(platform, externalId);

        const emoji =
          result.status === 'published'
            ? '✅'
            : result.status === 'scheduled'
              ? '📅'
              : result.status === 'failed'
                ? '❌'
                : '⏳';

        const lines: string[] = ['📊 Post status:\n'];
        lines.push(`Platform: ${result.platform}`);
        lines.push(`ID: ${result.externalId}`);
        lines.push(`Status: ${result.status} ${emoji}`);
        if (result.url) lines.push(`URL: ${result.url}`);

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `❌ Error fetching status: ${message}` }],
        };
      }
    },
  );
}
