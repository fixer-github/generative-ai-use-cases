import { useMemo } from 'react';
import { useBillingHttp } from './useHttp';

// Type definitions based on API specification

export type FlowType = 'purchase' | 'plan_change' | 'cancellation' | 'webhook_event';
export type FlowExecutionStatus = 'in_progress' | 'completed' | 'failed' | 'rolled_back';
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface FlowExecutionListItem {
  flow_execution_id: string;
  flow_type: FlowType;
  user_id: string | null;
  initiated_by: string;
  status: FlowExecutionStatus;
  started_at: string;
  completed_at: string | null;
  duration: number | null;
  current_step: string;
  total_steps: number | null;
  completed_steps: number | null;
  has_error: boolean;
}

export interface ListFlowExecutionsResponse {
  flow_executions: FlowExecutionListItem[];
  pagination: {
    next_token: string | null;
    has_next: boolean;
  };
}

export interface ListFlowExecutionsParams {
  limit?: number;
  next_token?: string;
  status?: FlowExecutionStatus;
  flow_type?: FlowType;
  user_id?: string;
  from_date?: string;
  to_date?: string;
}

export interface StepExecutionDetail {
  step_sequence: number;
  step_name: string;
  step_type: string;
  target_service: string | null;
  target_function: string | null;
  status: StepStatus;
  started_at: string | null;
  completed_at: string | null;
  duration: number | null;
  input_data: Record<string, unknown> | null;
  output_data: Record<string, unknown> | null;
  error_details: {
    error_code?: string;
    error_message: string;
    stack_trace?: string;
  } | null;
  retry_count: number;
}

export interface FlowExecutionDetail {
  flow_execution_id: string;
  tenant_id: string;
  flow_type: FlowType;
  user_id: string | null;
  initiated_by: string;
  status: FlowExecutionStatus;
  started_at: string;
  completed_at: string | null;
  duration: number | null;
  current_step: string;
  total_steps: number | null;
  completed_steps: number | null;
  input_parameters: Record<string, unknown>;
  output_result: Record<string, unknown> | null;
  error_details: {
    error_code?: string;
    error_message: string;
    stack_trace?: string;
  } | null;
}

export interface GetFlowExecutionResponse {
  flow_execution: FlowExecutionDetail;
  step_executions: StepExecutionDetail[];
}

const useFlowExecutionApi = () => {
  const { api } = useBillingHttp();

  return useMemo(() => ({
    /**
     * Get paginated list of flow executions with optional filters
     */
    listFlowExecutions: async (
      params?: ListFlowExecutionsParams
    ): Promise<ListFlowExecutionsResponse> => {
      const queryParams = new URLSearchParams();

      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.next_token) queryParams.append('next_token', params.next_token);
      if (params?.status) queryParams.append('status', params.status);
      if (params?.flow_type) queryParams.append('flow_type', params.flow_type);
      if (params?.user_id) queryParams.append('user_id', params.user_id);
      if (params?.from_date) queryParams.append('from_date', params.from_date);
      if (params?.to_date) queryParams.append('to_date', params.to_date);

      const queryString = queryParams.toString();
      const url = `/admin/billing/flow-executions${queryString ? `?${queryString}` : ''}`;

      const response = await api.get<ListFlowExecutionsResponse>(url);
      return response.data;
    },

    /**
     * Get detailed information of a specific flow execution including step executions
     */
    getFlowExecution: async (flowExecutionId: string): Promise<GetFlowExecutionResponse> => {
      const response = await api.get<GetFlowExecutionResponse>(
        `/admin/billing/flow-executions/${flowExecutionId}`
      );
      return response.data;
    },
  }), [api]);
};

export default useFlowExecutionApi;
