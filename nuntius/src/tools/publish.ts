// social_publish tool — publishes a post to one or more social media platforms

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PublishInputSchema } from '../engine/validator.js';
import type { PostPayload } from '../types.js';
import type { ToolContext } from './index.js';

export function registerPublishTool(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'social_publish',
    'Publish a post to one or more social media platforms',
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

      try {
        const results = await ctx.publishEngine.publish(platforms, payload);

        const lines: string[] = [];
        const successCount = results.filter(
          (r) => r.status === 'published' || r.status === 'scheduled',
        ).length;
        lines.push(`📤 Post published on ${results.length} platform(s):\n`);

        for (const r of results) {
          lines.push(`[${r.platform}] ID: ${r.externalId || '—'}`);
          if (r.status === 'published' || r.status === 'scheduled') {
            const emoji = r.status === 'published' ? '✅' : '📅';
            lines.push(`  Status: ${r.status} ${emoji}`);
            if (r.url) lines.push(`  URL: ${r.url}`);
          } else {
            lines.push(`  Status: ${r.status} ❌`);
            const errMsg = r.metadata?.error as string | undefined;
            if (errMsg) {
              const retryAfter = r.metadata?.retryAfterMs as number | undefined;
              if (retryAfter && retryAfter > 0) {
                lines.push(`  Error: ${errMsg}. Retry in ~${Math.round(retryAfter / 1000)}s`);
              } else {
                lines.push(`  Error: ${errMsg}`);
              }
            }
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Publish error: ${message}` }] };
      }
    },
  );
}
