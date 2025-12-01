import { useMemo } from 'react';
import { useBillingHttp } from './useHttp';

// Type definitions based on API specification
export interface Plan {
  plan_id: string;
  internal_name: string;
  display_name: string;
  description?: string;
  platform_type: 'stripe' | 'apple' | 'google' | 'internal';
  platform_product_id?: string;
  permissions: {
    features: string[];
    limits: {
      [key: string]: {
        type: 'unlimited' | 'daily' | 'monthly';
        count?: number;
      };
    };
  };
  status: 'active' | 'closed_to_new' | 'deprecated';
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanListItem {
  plan_id: string;
  internal_name: string;
  display_name: string;
  platform_type: 'stripe' | 'apple' | 'google' | 'internal';
  status: 'active' | 'closed_to_new' | 'deprecated';
  is_default: boolean;
  created_at: string;
}

export interface PlanListResponse {
  plans: PlanListItem[];
  pagination: {
    current_page: number;
    total_pages: number;
    total_count: number;
    limit: number;
    has_next: boolean;
    has_previous: boolean;
  };
  statistics: {
    total_plans: number;
    active_plans: number;
    closed_to_new_plans: number;
    deprecated_plans: number;
  };
}

export interface PlanHistoryItem {
  change_id: string;
  changed_at: string;
  changed_by: string;
  change_type: 'PLAN_CREATED' | 'STATUS_UPDATE' | 'PLAN_UPDATED';
  change_summary: string;
  details?: {
    field: string;
    old_value: string;
    new_value: string;
  };
}

export interface PlanHistoryResponse {
  plan_id: string;
  history: PlanHistoryItem[];
  pagination: {
    current_page: number;
    total_pages: number;
    total_count: number;
    limit: number;
    has_next: boolean;
    has_previous: boolean;
  };
}

export interface PlanSubscriptionsResponse {
  plan_id: string;
  total_subscribers: number;
  breakdown_by_source: {
    subscription: number;
    trial: number;
    manual: number;
    default: number;
    campaign: number;
  };
  breakdown_by_platform: {
    stripe: number;
    apple: number;
    google: number;
    internal: number;
  };
  trend: {
    period: string;
    data_points: Array<{
      date: string;
      subscriber_count: number;
    }>;
  };
  updated_at: string;
}

export interface CheckNameResponse {
  internal_name: string;
  available: boolean;
  conflicting_plan?: {
    plan_id: string;
    display_name: string;
    status: string;
  };
}

export interface CreatePlanRequest {
  internal_name: string;
  display_name: string;
  description?: string;
  platform_type: 'stripe' | 'apple' | 'google' | 'internal';
  platform_product_id?: string;
  permissions: {
    features: string[];
    limits: {
      [key: string]: {
        type: 'unlimited' | 'daily' | 'monthly';
        count?: number;
      };
    };
  };
}

export interface UpdatePlanStatusRequest {
  new_status: 'active' | 'closed_to_new' | 'deprecated';
}

export interface UpdatePlanStatusResponse {
  plan_id: string;
  internal_name: string;
  display_name: string;
  status: 'active' | 'closed_to_new' | 'deprecated';
  previous_status: 'active' | 'closed_to_new' | 'deprecated';
  updated_at: string;
  updated_by: string;
}

export interface SetDefaultPlanResponse {
  plan_id: string;
  internal_name: string;
  display_name: string;
  is_default: boolean;
  previous_default_plan: {
    plan_id: string;
    internal_name: string;
    display_name: string;
  } | null;
  updated_at: string;
  updated_by: string;
}

export interface SubscriberInfo {
  user_id: string;
  email: string | null;
  application_id: string;
  application_source: string;
  application_status: string;
  valid_from: string;
  valid_until: string | null;
  created_at: string;
}

export interface PlanSubscribersResponse {
  plan_id: string;
  plan_name: string;
  subscribers: SubscriberInfo[];
  pagination: {
    current_page: number;
    total_pages: number;
    total_count: number;
    limit: number;
    has_next: boolean;
    has_previous: boolean;
  };
}

export interface MigratePlanSubscribersRequest {
  targetPlanId: string;
  userIds: string[];
}

export interface MigrationResult {
  userId: string;
  success: boolean;
  applicationId?: string;
  previousApplicationIds?: string[];
  error?: {
    code: string;
    message: string;
  };
}

export interface MigratePlanSubscribersResponse {
  sourcePlanId: string;
  targetPlanId: string;
  totalCount: number;
  successCount: number;
  failureCount: number;
  results: MigrationResult[];
}

const usePlanApi = () => {
  const { api } = useBillingHttp();

  return useMemo(() => ({
    /**
     * Get paginated list of plans with optional filters
     */
    listPlans: async (params?: {
      page?: number;
      limit?: number;
      sort_by?: 'created_at' | 'internal_name' | 'status';
      sort_order?: 'asc' | 'desc';
      platform_type?: 'stripe' | 'apple' | 'google' | 'internal';
      status?: 'active' | 'closed_to_new' | 'deprecated';
      search?: string;
    }): Promise<PlanListResponse> => {
      const queryParams = new URLSearchParams();

      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.sort_by) queryParams.append('sort_by', params.sort_by);
      if (params?.sort_order) queryParams.append('sort_order', params.sort_order);
      if (params?.platform_type) queryParams.append('platform_type', params.platform_type);
      if (params?.status) queryParams.append('status', params.status);
      if (params?.search) queryParams.append('search', params.search);

      const queryString = queryParams.toString();
      const url = `/admin/billing/plans${queryString ? `?${queryString}` : ''}`;

      const response = await api.get<PlanListResponse>(url);
      return response.data;
    },

    /**
     * Get detailed information of a specific plan
     */
    getPlanDetails: async (planId: string): Promise<Plan> => {
      const response = await api.get<Plan>(`/admin/billing/plans/${planId}`);
      return response.data;
    },

    /**
     * Create a new plan
     */
    createPlan: async (planData: CreatePlanRequest): Promise<Plan> => {
      const response = await api.post<Plan>('/admin/billing/plans', planData);
      return response.data;
    },

    /**
     * Update plan status
     */
    updatePlanStatus: async (
      planId: string,
      statusData: UpdatePlanStatusRequest
    ): Promise<UpdatePlanStatusResponse> => {
      const response = await api.patch<UpdatePlanStatusResponse>(
        `/admin/billing/plans/${planId}/status`,
        statusData
      );
      return response.data;
    },

    /**
     * Get plan change history
     */
    getPlanHistory: async (
      planId: string,
      params?: {
        page?: number;
        limit?: number;
      }
    ): Promise<PlanHistoryResponse> => {
      const queryParams = new URLSearchParams();

      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());

      const queryString = queryParams.toString();
      const url = `/admin/billing/plans/${planId}/history${queryString ? `?${queryString}` : ''}`;

      const response = await api.get<PlanHistoryResponse>(url);
      return response.data;
    },

    /**
     * Get plan subscription statistics
     */
    getPlanSubscriptions: async (planId: string): Promise<PlanSubscriptionsResponse> => {
      const response = await api.get<PlanSubscriptionsResponse>(
        `/admin/billing/plans/${planId}/subscriptions`
      );
      return response.data;
    },

    /**
     * Check if internal name is available
     */
    checkPlanName: async (internalName: string): Promise<CheckNameResponse> => {
      const response = await api.get<CheckNameResponse>(
        `/admin/billing/plans/check-name?internal_name=${encodeURIComponent(internalName)}`
      );
      return response.data;
    },

    /**
     * Set a plan as the default plan
     */
    setDefaultPlan: async (planId: string): Promise<SetDefaultPlanResponse> => {
      const response = await api.put<SetDefaultPlanResponse>(
        `/admin/billing/plans/${planId}/default`
      );
      return response.data;
    },

    /**
     * Get plan subscribers (detailed list)
     */
    getPlanSubscribers: async (
      planId: string,
      params?: {
        page?: number;
        limit?: number;
      }
    ): Promise<PlanSubscribersResponse> => {
      const queryParams = new URLSearchParams();

      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());

      const queryString = queryParams.toString();
      const url = `/admin/billing/plans/${planId}/subscribers${queryString ? `?${queryString}` : ''}`;

      const response = await api.get<PlanSubscribersResponse>(url);
      return response.data;
    },

    /**
     * Migrate plan subscribers to another plan
     */
    migratePlanSubscribers: async (
      planId: string,
      data: MigratePlanSubscribersRequest
    ): Promise<MigratePlanSubscribersResponse> => {
      const response = await api.post<MigratePlanSubscribersResponse>(
        `/admin/billing/plans/${planId}/migrate`,
        data
      );
      return response.data;
    },
  }), [api]);
};

export default usePlanApi;
