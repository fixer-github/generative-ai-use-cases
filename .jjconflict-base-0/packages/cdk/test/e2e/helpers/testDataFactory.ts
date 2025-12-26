/**
 * Test Data Factory for E2E Tests
 *
 * Generates unique test data with identifiable prefixes for easy cleanup and filtering.
 * All test data uses E2E_TEST_PREFIX to be clearly distinguishable from production data.
 */

/**
 * Test data prefix for identifying test-generated data
 * Format: [E2E-TEST] prefix makes it unmistakably clear this is test data
 */
export const E2E_TEST_PREFIX = '[E2E-TEST]';

/**
 * Email-safe test data prefix (no brackets, valid for email local part)
 */
export const E2E_TEST_EMAIL_PREFIX = 'e2e-test';

/**
 * API error response type
 */
export interface ErrorResponse {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Generate a random ID
 */
function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Generate a unique test plan internal name
 * Format: [E2E-TEST]-plan-{timestamp}-{randomId}
 */
export function generateTestPlanInternalName(): string {
  return `${E2E_TEST_PREFIX}-plan-${Date.now()}-${randomId()}`;
}

/**
 * Generate a unique test user ID
 * Format: e2e-test-user-{timestamp}-{randomId}
 * Note: Uses E2E_TEST_EMAIL_PREFIX (no brackets) as user IDs are used in URL paths
 */
export function generateTestUserId(): string {
  return `${E2E_TEST_EMAIL_PREFIX}-user-${Date.now()}-${randomId()}`;
}

/**
 * Plan permissions type
 */
export interface PlanPermissions {
  features: string[];
  limits: Record<
    string,
    | { type: 'unlimited' }
    | { type: 'daily'; count: number }
    | { type: 'monthly'; count: number }
  >;
}

/**
 * Create plan request type
 */
export interface CreatePlanRequest {
  internal_name: string;
  display_name: string;
  description?: string;
  platform_type: 'stripe' | 'apple' | 'google' | 'internal';
  platform_product_id?: string;
  permissions: PlanPermissions;
}

/**
 * Create plan response type
 */
export interface CreatePlanResponse {
  plan_id: string;
  internal_name: string;
  display_name: string;
  description: string | null;
  platform_type: 'stripe' | 'apple' | 'google' | 'internal';
  platform_product_id: string | null;
  permissions: PlanPermissions;
  status: 'active' | 'closed_to_new' | 'deprecated';
  created_at: string;
  updated_at: string;
}

/**
 * Apply plan to user request type
 */
export interface ApplyPlanToUserRequest {
  planId: string;
}

/**
 * Apply plan to user response type
 */
export interface ApplyPlanToUserResponse {
  userId: string;
  planId: string;
  applicationId: string;
  previousApplicationIds: string[];
}

/**
 * Options for creating a test plan request
 */
export interface CreateTestPlanRequestOptions {
  displayName?: string;
  description?: string;
  platformType?: 'stripe' | 'apple' | 'google' | 'internal';
  platformProductId?: string;
  features?: string[];
  limits?: PlanPermissions['limits'];
}

/**
 * Create a test plan request with unique internal name
 */
export function createTestPlanRequest(
  options: CreateTestPlanRequestOptions = {}
): CreatePlanRequest {
  const {
    displayName = 'E2E Test Plan',
    description = 'Plan created by E2E tests',
    platformType = 'internal',
    platformProductId,
    features = ['feature:basic'],
    limits = {},
  } = options;

  const request: CreatePlanRequest = {
    internal_name: generateTestPlanInternalName(),
    display_name: displayName,
    description,
    platform_type: platformType,
    permissions: {
      features,
      limits,
    },
  };

  // Add platform_product_id for non-internal plans
  if (platformType !== 'internal' && platformProductId) {
    request.platform_product_id = platformProductId;
  }

  return request;
}

/**
 * Create a test plan request for Stripe
 */
export function createTestStripePlanRequest(
  priceId: string,
  options: Omit<CreateTestPlanRequestOptions, 'platformType' | 'platformProductId'> = {}
): CreatePlanRequest {
  return createTestPlanRequest({
    ...options,
    platformType: 'stripe',
    platformProductId: priceId,
  });
}
