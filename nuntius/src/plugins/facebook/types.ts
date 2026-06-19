/**
 * Facebook-specific types for Nuntius Facebook Graph API integration.
 */

export interface FacebookPostResponse {
  id: string;
}

export interface FacebookPhotoResponse {
  id: string;
  post_id?: string;
}

export interface FacebookError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id: string;
  };
}

export interface FacebookConfig {
  pageId: string;
  accessToken: string;
  apiVersion: string;
}
