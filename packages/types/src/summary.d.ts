import { PrimaryKey } from './base';

/**
 * Term unit for user summary aggregation period
 */
export type TermUnit = 'month' | 'year';

/**
 * Daily summary generated from a single day's conversations
 * PK: user#{userId}, SK: DAILY#{YYYY-MM-DD}
 */
export type DailySummary = PrimaryKey & {
  userId: string;
  tenantId: string;
  date: string; // YYYY-MM-DD
  summary: string; // Max 200 characters
  chatIds: string[];
  messageCount: number;
  externalContext?: string;
  generatedAt: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

/**
 * User summary aggregated from daily summaries within a term period
 * PK: user#{userId}, SK: USER_SUMMARY
 */
export type UserSummary = PrimaryKey & {
  userId: string;
  tenantId: string;
  summary: string; // Max 500 characters
  termUnit: TermUnit;
  termValue: number; // e.g., 1 month, 3 months, 1 year
  termStart: string; // YYYY-MM-DD
  termEnd: string; // YYYY-MM-DD
  dailySummaryDates: string[];
  generatedAt: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

/**
 * User-specific configuration for summary generation
 * PK: user#{userId}, SK: CONFIG
 */
export type UserSummaryConfig = PrimaryKey & {
  userId: string;
  tenantId: string;
  termUnit: TermUnit;
  termValue: number;
  externalContextPrompt?: string;
  enabled: boolean;
};

/**
 * Response type for GET /summaries API
 */
export type GetSummariesResponse = {
  dailySummary?: DailySummary;
  userSummary?: UserSummary;
  config?: UserSummaryConfig;
};

/**
 * Request body for updating user summary configuration
 */
export type UpdateSummaryConfigRequest = {
  termUnit?: TermUnit;
  termValue?: number;
  externalContextPrompt?: string;
  enabled?: boolean;
};
