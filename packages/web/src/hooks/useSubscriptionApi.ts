import { useMemo } from 'react';
import { useBillingHttp } from './useHttp';

// Type definitions
export interface Plan {
  planId: string;
  planName: string;
  displayName: string;
  platformProductId?: string;
  description?: string;
  features?: string[];
  pricing?: {
    amount: number;
    currency: string;
    interval?: 'month' | 'year';
  };
  limits?: {
    [key: string]: {
      type: 'unlimited' | 'daily' | 'monthly';
      count?: number;
    };
  };
  status: 'active' | 'closed_to_new' | 'deprecated';
}

export interface PlanListResponse {
  platform: 'web' | 'ios' | 'android';
  plans: Plan[];
}

export interface CheckoutSessionResponse {
  client_secret: string;
  session_id: string;
}

export interface CheckoutSessionRequest {
  planId: string;
  returnUrl?: string;
}

export interface CheckoutSessionStatus {
  status: 'complete' | 'incomplete' | 'expired';
  plan_name?: string;
  amount?: number;
  next_billing_date?: string;
}

export interface ActivateSubscriptionRequest {
  sessionId: string;
}

export interface ActivateSubscriptionResponse {
  success: boolean;
  planId?: string;
  planName?: string;
  activatedAt?: string;
  nextBillingDate?: string;
  error?: string;
  message?: string;
}

export interface CurrentSubscription {
  subscriptionId?: string;
  planId?: string;
  planName?: string;
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'none';
  nextBillingDate?: string;
  cancelAtPeriodEnd?: boolean;
}

export interface StoreInfo {
  stripePublishableKey: string | null;
  tenantId: string;
}

export interface CustomerPortalRequest {
  returnUrl: string;
}

export interface CustomerPortalResponse {
  url: string;
}

const useSubscriptionApi = () => {
  const { api } = useBillingHttp();

  return useMemo(
    () => ({
      // Get available plans for web platform
      listPlans: async (): Promise<PlanListResponse> => {
        const response = await api.get<PlanListResponse>(
          '/api/plans?platform=web'
        );
        return response.data;
      },

      // Create Stripe Checkout Session
      createCheckoutSession: async (
        request: CheckoutSessionRequest
      ): Promise<CheckoutSessionResponse> => {
        const response = await api.post<CheckoutSessionResponse>(
          '/api/subscriptions/checkout-session',
          request
        );
        return response.data;
      },

      // Check session status
      getSessionStatus: async (
        sessionId: string
      ): Promise<CheckoutSessionStatus> => {
        const response = await api.get<CheckoutSessionStatus>(
          `/api/subscriptions/checkout-session/${sessionId}/status`
        );
        return response.data;
      },

      // Activate subscription from session
      activateFromSession: async (
        request: ActivateSubscriptionRequest
      ): Promise<ActivateSubscriptionResponse> => {
        const response = await api.post<ActivateSubscriptionResponse>(
          '/api/subscriptions/activate-from-session',
          request
        );
        return response.data;
      },

      // Get current subscription
      getCurrentSubscription: async (): Promise<CurrentSubscription> => {
        const response = await api.get<CurrentSubscription>(
          '/api/subscriptions/current'
        );
        return response.data;
      },

      // Cancel subscription
      cancelSubscription: async (
        subscriptionId: string
      ): Promise<{
        success: boolean;
        flowExecutionId: string;
        cancellationType: string;
        effectiveDate: string;
        message: string;
      }> => {
        const response = await api.post<{
          success: boolean;
          flowExecutionId: string;
          cancellationType: string;
          effectiveDate: string;
          message: string;
        }>('/api/subscriptions/cancel', {
          subscriptionId,
          cancellationType: 'at_period_end', // 実装方針に従って期限終了時解約を採用
        });
        return response.data;
      },

      // Change subscription plan
      changeSubscriptionPlan: async (
        subscriptionId: string,
        newPlanId: string
      ): Promise<{
        success: boolean;
        flowExecutionId: string;
        changeType: 'upgrade' | 'downgrade';
        newPlanId: string;
        effectiveDate: string;
        message: string;
      }> => {
        const response = await api.post<{
          success: boolean;
          flowExecutionId: string;
          changeType: 'upgrade' | 'downgrade';
          newPlanId: string;
          effectiveDate: string;
          message: string;
        }>('/api/subscriptions/change-plan', {
          subscriptionId,
          newPlanId,
        });
        return response.data;
      },

      // Get store info (Stripe publishable key, etc.)
      getStoreInfo: async (): Promise<StoreInfo> => {
        const response = await api.get<StoreInfo>('/api/store-info');
        return response.data;
      },

      // Create Customer Portal session
      createCustomerPortalSession: async (
        request: CustomerPortalRequest
      ): Promise<CustomerPortalResponse> => {
        const response = await api.post<CustomerPortalResponse>(
          '/api/subscriptions/customer-portal',
          request
        );
        return response.data;
      },
    }),
    [api]
  );
};

export default useSubscriptionApi;
