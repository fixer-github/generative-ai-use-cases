// License (cash/consumption-based usage limit) types.
// Allocation and consumption are managed in JPY on the server; the API only
// ever exposes percentages (requirement 23: no raw amounts or token counts).

export type LicensePlan = {
  planId: string;
  name: string;
  // Monthly fee in JPY (tax excluded). Informational.
  monthlyFeeYen: number;
  // Monthly cost allocation in JPY. Consumption is charged against this.
  allocationYen: number;
  // Bedrock model IDs (full IDs, e.g. jp.anthropic.claude-...) usable on this plan.
  allowedModelIds: string[];
  enabled: boolean;
  createdDate: string;
  updatedDate: string;
};

export type LicenseUsageCategory =
  | 'chat'
  | 'generation'
  | 'summarize'
  | 'translate'
  | 'transcribe'
  | 'agent';

export type LicenseBreakdownEntry = {
  category: LicenseUsageCategory;
  // Consumption of this category as % of the monthly allocation (0-100).
  percent: number;
};

export type LicenseStatus = {
  // false when no plan is assigned or the assigned plan is disabled/deleted.
  assigned: boolean;
  planId: string | null;
  planName: string | null;
  // Plan change reserved for the next month (requirement 13).
  pendingPlanId: string | null;
  pendingPlanName: string | null;
  allowedModelIds: string[];
  // Remaining allocation in % (0-100). Negative balances are clamped to 0.
  remainingPercent: number;
  breakdown: LicenseBreakdownEntry[];
  // Next reset date (YYYY-MM-DD, JST 1st of next month).
  resetDate: string;
  warnThresholdPercent: number;
  criticalThresholdPercent: number;
  // Reporting interval for realtime transcription metering.
  rtReportIntervalSeconds: number;
};

export type GetMyLicenseResponse = {
  license: LicenseStatus;
};

// ----- Admin: plan management -----

export type ListLicensePlansResponse = {
  plans: LicensePlan[];
};

export type CreateLicensePlanRequest = {
  name: string;
  monthlyFeeYen: number;
  allocationYen: number;
  allowedModelIds: string[];
  enabled?: boolean;
};

export type CreateLicensePlanResponse = {
  plan: LicensePlan;
};

export type UpdateLicensePlanRequest = {
  name?: string;
  monthlyFeeYen?: number;
  allocationYen?: number;
  allowedModelIds?: string[];
  enabled?: boolean;
};

export type UpdateLicensePlanResponse = {
  plan: LicensePlan;
};

// ----- Admin: user assignment -----

export type AssignUserLicenseRequest = {
  // null = unassign
  planId: string | null;
};

export type AssignUserLicenseResponse = {
  license: LicenseStatus;
  // 'immediate': first assignment or unassignment.
  // 'nextMonth': change between plans, applied on the 1st of next month.
  applied: 'immediate' | 'nextMonth';
};

export type GetUserLicenseResponse = {
  license: LicenseStatus;
};

export type LicenseUsageSummaryEntry = {
  userId: string;
  planId: string | null;
  planName: string | null;
  pendingPlanName: string | null;
  assigned: boolean;
  remainingPercent: number;
  exhausted: boolean;
};

export type GetLicenseUsageSummaryResponse = {
  entries: LicenseUsageSummaryEntry[];
  exhaustedCount: number;
};

// ----- Realtime transcription metering -----

export type StartTranscribeSessionRequest = {
  sessionId: string;
  mode: 'mic' | 'screen';
};

export type StartTranscribeSessionResponse = {
  allowed: boolean;
  reason?: 'unassigned' | 'exhausted' | 'error';
  remainingPercent: number;
  reportIntervalSeconds: number;
};

export type ReportTranscribeSessionRequest = {
  sessionId: string;
  // Cumulative audio seconds sent to Transcribe since session start.
  cumulativeSeconds: number;
  // true on the last report when the session stops.
  final?: boolean;
};

export type ReportTranscribeSessionResponse = {
  remainingPercent: number;
  // true when the client must stop the streaming session (allocation used up).
  stop: boolean;
};
