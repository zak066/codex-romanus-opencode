/**
 * Imago Error Hierarchy
 *
 * Custom error classes for structured error handling across the MCP server.
 * Each error carries a machine-readable `code` and optional HTTP `statusCode`
 * for consistent error reporting in MCP tool responses.
 */

export class ImagoError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ComfyUIConnectionError extends ImagoError {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message, 'COMFYUI_CONNECTION_ERROR', 502);
    this.name = 'ComfyUIConnectionError';
    this.cause = cause;
  }
}

export class ComfyUIRequestError extends ImagoError {
  constructor(message: string, statusCode?: number) {
    super(message, 'COMFYUI_REQUEST_ERROR', statusCode ?? 502);
    this.name = 'ComfyUIRequestError';
  }
}

export class WorkflowValidationError extends ImagoError {
  constructor(message: string) {
    super(message, 'WORKFLOW_VALIDATION_ERROR', 400);
    this.name = 'WorkflowValidationError';
  }
}

export class AssetNotFoundError extends ImagoError {
  constructor(assetId: string) {
    super(`Asset not found: ${assetId}`, 'ASSET_NOT_FOUND', 404);
    this.name = 'AssetNotFoundError';
  }
}

export class ConfigurationError extends ImagoError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR', 500);
    this.name = 'ConfigurationError';
  }
}

export class ImageProcessingError extends ImagoError {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message, 'IMAGE_PROCESSING_ERROR', 500);
    this.name = 'ImageProcessingError';
    this.cause = cause;
  }
}

