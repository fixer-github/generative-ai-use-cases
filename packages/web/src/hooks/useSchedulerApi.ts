/**
 * Scheduler API Hook
 *
 * Provides CRUD operations for scheduled tasks and execution log retrieval.
 */

import useHttp from './useHttp';
import { useMemo } from 'react';

// --- Types (mirrors backend types.ts) ---

export type ScheduleType = 'daily' | 'weekly' | 'monthly';

export interface ScheduleConfig {
  type: ScheduleType;
  time: string; // "HH:mm" (JST)
  daysOfWeek?: number[]; // weekly: 1=Mon ... 7=Sun
  dayOfMonth?: number; // monthly: 1-28
}

export type ExecutionStatus = 'running' | 'success' | 'error';

// step 5 lifecycle / failure classification.
export type TaskStatus = 'active' | 'paused' | 'error';
export type ErrorCategory = 'transient' | 'permanent';
export type ExecutionTrigger = 'schedule' | 'retry' | 'manual';

export interface TaskLastError {
  category: ErrorCategory;
  message: string;
  at: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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
  // step 5: lifecycle/health (optional for back-compat with pre-step-5 responses).
  status?: TaskStatus;
  consecutiveFailures?: number;
  lastError?: TaskLastError;
}

export interface TaskExecutionSummary {
  executionId: string;
  taskId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  // step 5: failure classification + retry-timeline metadata.
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

// --- Hook ---

const useSchedulerApi = () => {
  const http = useHttp();

  return useMemo(
    () => ({
      // Task CRUD
      listTasks: () => {
        // step 5: response now also carries the quota meter (remaining/limit).
        return http.get<{
          tasks: ScheduledTaskResponse[];
          remaining?: number;
          limit?: number;
        }>('/schedules');
      },

      getTask: (taskId: string | null) => {
        return http.get<{ task: ScheduledTaskResponse }>(
          taskId ? `/schedules/${taskId}` : null
        );
      },

      createTask: (data: CreateScheduledTaskRequest) => {
        return http.post<{ task: ScheduledTaskResponse }>('/schedules', data);
      },

      updateTask: (taskId: string, data: UpdateScheduledTaskRequest) => {
        return http.put<{ task: ScheduledTaskResponse }>(
          `/schedules/${taskId}`,
          data
        );
      },

      deleteTask: (taskId: string) => {
        return http.delete(`/schedules/${taskId}`);
      },

      // step 5: manual "run now" (async; result surfaces via history + bell).
      runNow: (taskId: string) => {
        return http.post(`/schedules/${taskId}/run`, {});
      },

      // Execution Logs
      listExecutionsByUser: (startDate: string, endDate: string) => {
        return http.get<{ executions: TaskExecutionSummary[] }>(
          `/schedules/executions?startDate=${startDate}&endDate=${endDate}`
        );
      },

      listExecutions: (taskId: string | null, limit?: number) => {
        const params = limit ? `?limit=${limit}` : '';
        return http.get<{ executions: TaskExecutionSummary[] }>(
          taskId ? `/schedules/${taskId}/executions${params}` : null
        );
      },

      getExecution: (taskId: string | null, executionId: string | null) => {
        return http.get<{ execution: TaskExecutionDetail }>(
          taskId && executionId
            ? `/schedules/${taskId}/executions/${encodeURIComponent(executionId)}`
            : null
        );
      },
    }),
    [http]
  );
};

export default useSchedulerApi;
