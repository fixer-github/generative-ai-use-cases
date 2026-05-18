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
        return http.get<{ tasks: ScheduledTaskResponse[] }>('/schedules');
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
