export type PlatformType = 'stripe' | 'apple' | 'google';

export interface WebhookEvent {
  event_id: string;
  received_at: string; // ISO 8601 format
  platform_type: PlatformType;
  event_type: string;
  event_data: Record<string, any>;
  processed_status: 'pending' | 'processed' | 'error';
  ttl: number; // Unix timestamp
}

export interface VerificationResult {
  success: boolean;
  data?: {
    subscriptionId?: string;
    productId?: string;
    expiresAt?: string;
    [key: string]: any;
  };
  cached?: boolean;
}

export interface ReceiptCache {
  receipt_hash: string;
  verification_result: VerificationResult;
  verified_at: string; // ISO 8601 format
  ttl: number; // Unix timestamp
}
