/**
 * TypeScript interfaces for ComfyUI REST API.
 *
 * Based on ComfyUI API reference:
 * - POST /prompt
 * - GET /history/{prompt_id}
 * - GET /system_stats
 * - GET /queue
 * - GET /object_info
 * - GET /view
 */

// ─── Prompt / Queue ──────────────────────────────────────────────────────────

/** Request body for POST /prompt */
export interface PromptRequest {
  prompt: Record<string, WorkflowNode>;
  extra_data?: Record<string, unknown>;
  client_id?: string;
}

/** Response from POST /prompt */
export interface PromptResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, NodeError>;
}

export interface NodeError {
  class_type: string;
  errors: string[];
}

/** A single node in ComfyUI workflow (API format) */
export interface WorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: {
    title?: string;
  };
}

// ─── History ─────────────────────────────────────────────────────────────────

/** Response from GET /history/{prompt_id} */
export interface HistoryResponse {
  [promptId: string]: {
    prompt: unknown;
    outputs: Record<string, Output>;
    status: {
      completed: boolean;
      messages?: Array<[string, unknown]>;
    };
  };
}

/** Output from a single node in history */
export interface Output {
  images?: OutputImage[];
}

export interface OutputImage {
  filename: string;
  subfolder: string;
  type: 'output' | 'input' | 'temp';
}

// ─── System Stats ────────────────────────────────────────────────────────────

/** Response from GET /system_stats */
export interface SystemStats {
  system: {
    os: string;
    python_version: string;
    comfyui_version: string;
    args: Record<string, unknown>;
  };
  devices: DeviceInfo[];
}

export interface DeviceInfo {
  name: string;
  type: 'cuda' | 'cpu' | 'mps';
  index: number;
  vram_total?: number;
  vram_free?: number;
  torch_version: string;
}

// ─── Queue ───────────────────────────────────────────────────────────────────

/** Response from GET /queue */
export interface QueueResponse {
  queue_running: Array<[number, number]>;
  queue_pending: Array<[number, number]>;
}

// ─── Object Info ─────────────────────────────────────────────────────────────

/** Response from GET /object_info */
export type ObjectInfoResponse = Record<string, NodeDefinition>;

export interface NodeDefinition {
  name: string;
  display_name: string;
  description: string;
  category: string;
  input: {
    required: Record<string, FieldDefinition>;
    optional?: Record<string, FieldDefinition>;
  };
  output: string[];
  output_name: string[];
}

/**
 * Field definition tuple from ComfyUI.
 *
 * First element: type name or array of valid values.
 * Second element (optional): additional constraints/options.
 */
export type FieldDefinition = [string | string[]] | [string | string[], Record<string, unknown>];

// ─── Asset Identity ──────────────────────────────────────────────────────────

/**
 * Stable identity tuple for ComfyUI output assets (ADR-023).
 *
 * This (filename, subfolder, type) triple uniquely identifies an output
 * regardless of hostname/port changes.
 */
export interface AssetIdentity {
  filename: string;
  subfolder: string;
  type: 'output' | 'input' | 'temp';
}
