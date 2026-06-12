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

// Lifecycle status (step 5). `status` is the source of truth; `enabled` is kept
// as a derived projection (`enabled === (status === 'active')`) so the existing
// execute-Lambda guard and the old UI keep working untouched.
//   active : running on schedule (EventBridge ENABLED)
//   paused : stopped by the user (no error)
//   error  : auto-stopped by the failure handler. Refined by `lastError.category`
//            (permanent -> sched_failed bell / transient 3x -> sched_paused bell).
export type TaskStatus = 'active' | 'paused' | 'error';

// Classification of an execution failure (reused from the in-Lambda isRetryable
// heuristic). Transient failures are retried (30s/2m/8m); permanent ones stop now.
export type ErrorCategory = 'transient' | 'permanent';

export interface TaskLastError {
  category: ErrorCategory;
  message: string;
  at: string; // ISO timestamp of the failure
}

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
  updatedAt: string;
  // --- step 5: failure handling / lifecycle (all optional for back-compat;
  //     legacy rows are read as `enabled ? 'active' : 'paused'`). ---
  status?: TaskStatus;
  consecutiveFailures?: number; // streak length; reset to 0 on success/re-enable
  lastError?: TaskLastError;
}

// --- Task Execution ---

export type ExecutionStatus = 'running' | 'success' | 'error';

// What triggered this execution: the recurring cron fire, an auto-retry one-time
// schedule, or a manual "run now" invocation.
export type ExecutionTrigger = 'schedule' | 'retry' | 'manual';

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
  // --- step 5 ---
  errorCategory?: ErrorCategory; // set on failure
  attempt?: number; // 1 = initial fire; 2/3/4 = retries (for the timeline UI)
  trigger?: ExecutionTrigger;
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
  // step 5: lifecycle/health surfaced to the list & detail UI.
  status: TaskStatus;
  consecutiveFailures: number;
  lastError?: TaskLastError;
}

// step 5: list response now carries the per-user quota meter (D7: limit 10).
export interface ListTasksResponse {
  tasks: ScheduledTaskResponse[];
  remaining: number;
  limit: number;
}

export interface TaskExecutionSummary {
  executionId: string;
  taskId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  errorCategory?: ErrorCategory;
  attempt?: number;
  trigger?: ExecutionTrigger;
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
  // Absent for the recurring cron fire (treated as 'schedule'). Set to 'retry'
  // by the one-time retry schedules and 'manual' by the "run now" invocation.
  trigger?: ExecutionTrigger;
}
