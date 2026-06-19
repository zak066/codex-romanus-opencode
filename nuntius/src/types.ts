// Types for Nuntius Social Media MCP Server

export type PublishStatus = 'published' | 'scheduled' | 'failed' | 'pending_review';

export interface PostPayload {
  text: string;
  mediaUrls?: string[];
  scheduledAt?: string; // ISO 8601
  platformSpecific?: Record<string, unknown>;
}

export interface PublishResult {
  platform: string;
  externalId: string;
  url?: string;
  status: PublishStatus;
  metadata?: Record<string, unknown>;
  publishedAt: string;
}

export interface PostStatusResult {
  platform: string;
  externalId: string;
  status: PublishStatus;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface MediaConstraints {
  supportedTypes: string[];
  maxFileSize?: number;
  maxFiles?: number;
  aspectRatio?: string;
  minWidth?: number;
  minHeight?: number;
}

export interface PlatformConfig {
  name: string;
  configured: boolean;
  missingConfig?: string[];
  rateLimitRemaining?: number;
}

export interface NuntiusConfig {
  facebook?: {
    pageId: string;
    accessToken: string;
    apiVersion: string;
  };
  instagram?: {
    userId: string;
    accessToken: string;
    pageId: string;
  };
}
