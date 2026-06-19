// Instagram-specific types for the Instagram Graph API (Content Publishing API)

export interface InstagramMediaContainerResponse {
  id: string;
}

export interface InstagramMediaPublishResponse {
  id: string;
  media_product_type?: string;
}

export interface InstagramMediaStatusResponse {
  id: string;
  status_code: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
}

export interface InstagramError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
  };
}

export interface InstagramConfig {
  userId: string;
  accessToken: string;
  pageId?: string;
}
