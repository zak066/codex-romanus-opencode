// social_validate tool — validates a post against one or more platforms without publishing

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PublishInputSchema } from '../engine/validator.js';
import type { PostPayload } from '../types.js';
import type { ToolContext } from './index.js';

export function registerValidateTool(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'social_validate',
    'Validate a post against one or more platforms without publishing',
    PublishInputSchema.shape,
    async (args) => {
      const parsed = PublishInputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }],
        };
      }

      const { platforms, text, mediaUrls, scheduledAt, platformSpecific } = parsed.data;
      const payload: PostPayload = { text };
      if (mediaUrls) payload.mediaUrls = mediaUrls;
      if (scheduledAt) payload.scheduledAt = scheduledAt;
      if (platformSpecific) payload.platformSpecific = platformSpecific;

      const lines: string[] = ['📋 Validation results:\n'];

      for (const platform of platforms) {
        const result = await ctx.publishEngine.validate([platform], payload);

        if (result.valid) {
          lines.push(`[${platform}] ✅ Valid`);
          if (result.warnings && result.warnings.length > 0) {
            for (const w of result.warnings) {
              lines.push(`  ⚠️ ${w}`);
            }
          }
        } else {
          lines.push(`[${platform}] ❌ Invalid`);
          for (const e of result.errors) {
            lines.push(`  Error: ${e}`);
          }
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
}
