// social_accounts tool — lists all connected social media accounts

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './index.js';

export function registerAccountsTool(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'social_accounts',
    'List all connected social media accounts and their configuration status',
    {},
    async () => {
      const platforms = ctx.registry.listPlatforms();
      const lines: string[] = ['👤 Connected accounts:\n'];

      // Facebook
      if (ctx.config.facebook) {
        const status = platforms.includes('facebook') ? '✅' : '⚠️  Plugin not loaded';
        lines.push(`facebook: ${ctx.config.facebook.pageId} ${status}`);
      } else {
        lines.push(`facebook: Not configured ❌`);
      }

      // Instagram
      if (ctx.config.instagram) {
        const status = platforms.includes('instagram') ? '✅' : '⚠️  Plugin not loaded';
        lines.push(`instagram: ${ctx.config.instagram.userId} ${status}`);
      } else {
        lines.push(`instagram: Not configured ❌`);
      }

      // Show any additional registered plugins not covered by config
      const extra = platforms.filter((p) => p !== 'facebook' && p !== 'instagram');
      if (extra.length > 0) {
        lines.push('');
        for (const name of extra) {
          lines.push(`${name}: Plugin loaded ✅`);
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
}
