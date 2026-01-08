/**
 * Daily summary for a user's conversations on a specific date
 */
export interface DailySummary {
  id?: string; // DynamoDB partition key (user#userId)
  createdDate?: string; // DynamoDB sort key (DAILY#date)
  userId: string;
  tenantId: string;
  date: string; // YYYY-MM-DD
  summary: string;
  chatIds: string[];
  messageCount: number;
  externalContext?: string; // External context used for summary generation
  generatedAt: string; // ISO timestamp
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Aggregated user summary over a term period
 */
export interface UserSummary {
  id?: string; // DynamoDB partition key (user#userId)
  createdDate?: string; // DynamoDB sort key (USER_SUMMARY)
  userId: string;
  tenantId: string;
  summary: string;
  termUnit: 'month' | 'year';
  termValue: number;
  termStart: string; // YYYY-MM-DD
  termEnd: string; // YYYY-MM-DD
  dailySummaryDates: string[];
  generatedAt: string; // ISO timestamp
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * User-specific summary configuration
 */
export interface UserSummaryConfig {
  id?: string; // DynamoDB partition key (user#userId)
  createdDate?: string; // DynamoDB sort key (CONFIG)
  userId: string;
  tenantId: string;
  termUnit?: 'month' | 'year';
  termValue?: number;
  externalContextPrompt?: string; // Custom prompt for external context
  enabled?: boolean; // Whether summary generation is enabled
  updatedAt?: string;
}

/**
 * Request to update summary configuration
 */
export interface UpdateSummaryConfigRequest {
  termUnit?: 'month' | 'year';
  termValue?: number;
  externalContextPrompt?: string;
  enabled?: boolean;
}

/**
 * Response from GET /summaries endpoint
 */
export interface GetSummariesResponse {
  dailySummary?: DailySummary;
  userSummary?: UserSummary;
  config?: UserSummaryConfig;
}
