/**
 * Tipi base per il protocollo MCP (Model Context Protocol).
 * Definisce le interfacce per ResourceContent, ToolResult, PromptMessage e PromptResult.
 */

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text';
    text: string;
  };
}

export interface PromptResult {
  description: string;
  messages: PromptMessage[];
}

/**
 * Interfaccia per un Resource Handler MCP.
 */
export interface ResourceHandler {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: () => Promise<ResourceContent[]>;
}

/**
 * Interfaccia per un Tool Handler MCP.
 */
export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * Interfaccia per un Prompt Handler MCP.
 */
export interface PromptHandler {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  handler: (args?: Record<string, string>) => Promise<PromptResult>;
}
