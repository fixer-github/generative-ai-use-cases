/**
 * Scheduler Feature - Type Definitions
 */

// --- Schedule Configuration ---

export type ScheduleType = 'daily' | 'weekly' | 'monthly';

export interface ScheduleConfig {
  type: ScheduleType;
  time: string; // "HH:mm" (JST)
  daysOfWeek?: number[]; // weekly: 1=Mon, 2=Tue, ..., 7=Sun
  dayOfMonth?: number; // monthly: 1-28
}

// --- Scheduled Task ---

export interface ScheduledTask {
  pk: string; // scheduledTask#{userId}
  sk: string; // {taskId}
  taskId: string;
  taskName: string;
  prompt: string;
  agentName: string;
  modelId: string;
  schedule: ScheduleConfig;
  eventBridgeScheduleName: string;
  enabled: boolean;
  deleted: boolean;
  userId: string;
  snsTopicArn?: string;
  updatedAt: string;
}

// --- Task Execution ---

export type ExecutionStatus = 'running' | 'success' | 'error';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TaskExecution {
  pk: string; // taskExecution#{taskId}
  sk: string; // {executionId}
  executionId: string;
  taskId: string;
  userId: string;
  status: ExecutionStatus;
  resultText: string;
  errorMessage?: string;
  tokenUsage?: TokenUsage;
  emailSent: boolean;
  startedAt: string;
  completedAt?: string;
}

// --- API Request/Response Types ---

export interface CreateScheduledTaskRequest {
  taskName: string;
  prompt: string;
  agentName: string;
  modelId: string;
  schedule: ScheduleConfig;
}

export interface UpdateScheduledTaskRequest {
  taskName?: string;
  prompt?: string;
  agentName?: string;
  modelId?: string;
  schedule?: ScheduleConfig;
  enabled?: boolean;
}

export interface ScheduledTaskResponse {
  taskId: string;
  taskName: string;
  prompt: string;
  agentName: string;
  modelId: string;
  schedule: ScheduleConfig;
  enabled: boolean;
  updatedAt: string;
}

export interface TaskExecutionSummary {
  executionId: string;
  taskId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
}

export interface TaskExecutionDetail extends TaskExecutionSummary {
  resultText: string;
  errorMessage?: string;
  tokenUsage?: TokenUsage;
  emailSent: boolean;
}

// --- EventBridge Scheduler Payload ---

export interface SchedulerEventPayload {
  taskId: string;
  userId: string;
  scheduledTime: string;
}

// --- SNS Notification User Info ---

export interface UserNotificationInfo {
  snsTopicArn: string;
  email: string;
}
