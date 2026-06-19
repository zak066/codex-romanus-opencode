import 'dotenv/config';

export interface ImagoConfig {
  comfyui: {
    url: string;
    clientId: string;
  };
  langsearch?: {
    apiKey?: string;
  };
}

let cachedConfig: ImagoConfig | null = null;

/**
 * Load configuration from environment variables.
 * Uses defaults chain: hardcoded default → env var → runtime override.
 */
export function loadConfig(): ImagoConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const config: ImagoConfig = {
    comfyui: {
      url: process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188',
      clientId: process.env.COMFYUI_CLIENT_ID ?? crypto.randomUUID(),
    },
    langsearch: {
      apiKey: process.env.LANGSEARCH_API_KEY,
    },
  };

  // Normalize URL: strip trailing slash
  config.comfyui.url = config.comfyui.url.replace(/\/+$/, '');

  cachedConfig = config;
  return config;
}

/**
 * Reset cached config (useful for testing).
 */
export function resetConfig(): void {
  cachedConfig = null;
}
