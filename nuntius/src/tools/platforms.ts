// social_list_platforms tool — lists all available platforms and their configuration status

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './index.js';

export function registerListPlatformsTool(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'social_list_platforms',
    'List all available social media platforms and their configuration status',
    {},
    async () => {
      const platforms = ctx.registry.listPlatforms();
      const lines: string[] = ['📡 Available platforms:\n'];

      if (platforms.length === 0) {
        lines.push('No platforms are currently configured.\n');
        lines.push('To configure a platform, set the required environment variables:');
        lines.push('  - Facebook: FACEBOOK_PAGE_ID, FACEBOOK_ACCESS_TOKEN');
        lines.push('  - Instagram: INSTAGRAM_USER_ID, INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_PAGE_ID');
      } else {
        for (const name of platforms) {
          const stats = ctx.rateLimiter.getStats(name);
          const remaining = stats ? stats.remaining : '?';
          const total = stats ? stats.total : '?';

          lines.push(`[${name}] ✅ Configured`);

          // Show platform-specific config details
          if (name === 'facebook' && ctx.config.facebook) {
            lines.push(`  Page: ${ctx.config.facebook.pageId}`);
          } else if (name === 'instagram' && ctx.config.instagram) {
            lines.push(`  User: ${ctx.config.instagram.userId}`);
          }

          lines.push(`  Rate limit: ${remaining}/${total} remaining`);
        }

        // Check for known platforms that are in config but NOT registered
        // (plugin failed to load despite having env vars)
        const configPlatforms: Array<{ name: string; reason: string }> = [];
        if (ctx.config.facebook && !platforms.includes('facebook')) {
          configPlatforms.push({ name: 'facebook', reason: 'Plugin failed to load' });
        }
        if (ctx.config.instagram && !platforms.includes('instagram')) {
          configPlatforms.push({ name: 'instagram', reason: 'Plugin failed to load' });
        }

        if (configPlatforms.length > 0) {
          lines.push('');
          for (const p of configPlatforms) {
            lines.push(`[${p.name}] ❌ ${p.reason}`);
          }
        }

        // Show platforms referenced in config that are not registered
        // (env vars might be partially missing)
        const envPlatforms: Array<{ name: string; missing: string[] }> = [];
        const fbPageId = process.env.FACEBOOK_PAGE_ID;
        const fbToken = process.env.FACEBOOK_ACCESS_TOKEN;
        if ((!fbPageId || !fbToken) && !platforms.includes('facebook')) {
          const missing: string[] = [];
          if (!fbPageId) missing.push('FACEBOOK_PAGE_ID');
          if (!fbToken) missing.push('FACEBOOK_ACCESS_TOKEN');
          if (missing.length > 0) {
            envPlatforms.push({ name: 'facebook', missing });
          }
        }

        const igUserId = process.env.INSTAGRAM_USER_ID;
        const igToken = process.env.INSTAGRAM_ACCESS_TOKEN;
        if ((!igUserId || !igToken) && !platforms.includes('instagram')) {
          const missing: string[] = [];
          if (!igUserId) missing.push('INSTAGRAM_USER_ID');
          if (!igToken) missing.push('INSTAGRAM_ACCESS_TOKEN');
          if (missing.length > 0) {
            envPlatforms.push({ name: 'instagram', missing });
          }
        }

        if (envPlatforms.length > 0) {
          lines.push('');
          for (const p of envPlatforms) {
            lines.push(`[${p.name}] ❌ Not configured`);
            lines.push(`  Missing: ${p.missing.join(', ')}`);
          }
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
}
