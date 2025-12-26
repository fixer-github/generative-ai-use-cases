/**
 * Internal Function Clients
 *
 * オーケストレーション層から各責務のInternal関数を呼び出すためのクライアント群
 */

export {
  PlanManagementClient,
  PlanManagementClientError,
  type ApplyPlanToUserParams,
  type ApplyPlanToUserResponse,
  type TerminatePlanApplicationParams,
  type TerminatePlanApplicationResponse,
  type UpdatePlanApplicationStatusParams,
  type UpdatePlanApplicationStatusResponse,
} from './planManagementClient';

export {
  SubscriptionManagementClient,
  SubscriptionManagementClientError,
  type CreateSubscriptionParams,
  type CreateSubscriptionResponse,
  type UpdateSubscriptionStatusParams,
  type UpdateSubscriptionStatusResponse,
  type GetSubscriptionParams,
  type ExtendSubscriptionPeriodParams,
  type ExtendSubscriptionPeriodResponse,
} from './subscriptionManagementClient';

export {
  PaymentGatewayClient,
  PaymentGatewayClientError,
  type VerifyReceiptParams,
  type VerifyReceiptResponse,
  type UpdateSubscriptionParams,
  type UpdateSubscriptionResponse,
  type CancelSubscriptionParams,
  type CancelSubscriptionResponse,
} from './paymentGatewayClient';
