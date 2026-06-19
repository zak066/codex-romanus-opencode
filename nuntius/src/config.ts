import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import type { NuntiusConfig } from './types.js';

/* Fallback: carica .env dal percorso del modulo (utile quando eseguito localmente) */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

/**
 * Loads Nuntius configuration from environment variables.
 *
 * Environment variables:
 *   FACEBOOK_PAGE_ID, FACEBOOK_ACCESS_TOKEN, FACEBOOK_API_VERSION
 *   INSTAGRAM_USER_ID, INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_PAGE_ID
 *
 * Returns a NuntiusConfig object. If a platform's required variables
 * are not all present, the corresponding config field is left undefined.
 */
export function loadConfig(): NuntiusConfig {
  const config: NuntiusConfig = {};

  // Facebook
  const fbPageId = process.env.FACEBOOK_PAGE_ID;
  const fbAccessToken = process.env.FACEBOOK_ACCESS_TOKEN;
  const fbApiVersion = process.env.FACEBOOK_API_VERSION;

  if (fbPageId && fbAccessToken) {
    config.facebook = {
      pageId: fbPageId,
      accessToken: fbAccessToken,
      apiVersion: fbApiVersion || 'v22.0',
    };
  }

  // Instagram
  const igUserId = process.env.INSTAGRAM_USER_ID;
  const igAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igPageId = process.env.INSTAGRAM_PAGE_ID;

  if (igUserId && igAccessToken) {
    config.instagram = {
      userId: igUserId,
      accessToken: igAccessToken,
      pageId: igPageId || '',
    };
  }

  return config;
}

/**
 * Returns an array of missing (unset) environment variables for a given prefix.
 *
 * @param prefix — env var prefix (e.g. "FACEBOOK_")
 * @param requiredVars — list of variable names WITHOUT the prefix
 *                       (e.g. ["PAGE_ID", "ACCESS_TOKEN"])
 * @returns the subset of variable names that are not set in process.env
 */
export function getMissingConfig(prefix: string, requiredVars: string[]): string[] {
  return requiredVars.filter((key) => {
    const fullKey = `${prefix}${key}`;
    return !process.env[fullKey];
  });
}
