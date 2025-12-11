/**
 * E2Eテスト: プラン管理フロー
 *
 * テスト対象フロー:
 * 1. 管理者が新規プランを作成
 * 2. 管理者がユーザーにプランを適用
 *
 * クリーンアップ戦略:
 * - プランはAPI経由でdeprecated化（ソフトデリート）
 * - テストデータは[E2E-TEST]プレフィックスで明確に識別可能
 * - テスト用管理者ユーザーはCognitoに自動作成・自動削除
 * - ユーザープラン適用はテストユーザーID（[E2E-TEST]-user-*）で分離されているためDBに残留
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  ApiClient,
  TestCleanupHelper,
  TestResourceTracker,
  TestUserManager,
  createTestPlanRequest,
  generateTestUserId,
  E2E_TEST_PREFIX,
} from '../helpers';
import type {
  CreatePlanResponse,
  ApplyPlanToUserResponse,
  ErrorResponse,
} from '../helpers';
import { testConfig } from '../setup';

describe('プラン管理 E2Eフロー', () => {
  let apiClient: ApiClient;
  let cleanupHelper: TestCleanupHelper;
  let tracker: TestResourceTracker;
  let userManager: TestUserManager;

  beforeAll(async () => {
    // Create test admin user in Cognito
    userManager = new TestUserManager();
    const adminUser = await userManager.createAdminUser(testConfig.tenantId);

    // Create API client with test user's token
    apiClient = ApiClient.create(adminUser.token);

    // Initialize cleanup helper with API client (not singleton for parallel safety)
    cleanupHelper = new TestCleanupHelper(apiClient);

    // Initialize resource tracker
    tracker = new TestResourceTracker();
  });

  afterEach(async () => {
    // Cleanup tracked resources after each test
    try {
      await tracker.cleanup(cleanupHelper);
    } catch (error) {
      console.warn('Cleanup error (continuing):', error);
    }
  });

  afterAll(async () => {
    // Cleanup test admin user from Cognito
    try {
      await userManager.cleanup();
    } catch (error) {
      console.warn('User cleanup error (continuing):', error);
    }
  });

  describe('正常系: プラン作成とユーザーへの適用', () => {
    it('新規internalプランを正常に作成できること', async () => {
      // Arrange
      const planRequest = createTestPlanRequest({
        displayName: 'E2E Test - Basic Plan',
        description: 'Basic plan for E2E testing',
        features: ['feature:basic', 'feature:chat'],
        limits: {
          'feature:chat': { type: 'daily', count: 100 },
        },
      });

      // Act
      const response = await apiClient.post<CreatePlanResponse>(
        '/admin/billing/plans',
        planRequest
      );

      // Assert
      expect(response.status).toBe(201);
      expect(response.data.plan_id).toBeDefined();
      expect(response.data.internal_name).toBe(planRequest.internal_name);
      expect(response.data.display_name).toBe(planRequest.display_name);
      expect(response.data.platform_type).toBe('internal');
      expect(response.data.status).toBe('active');
      expect(response.data.permissions.features).toEqual(
        planRequest.permissions.features
      );

      // Track for cleanup
      tracker.trackPlan(response.data.plan_id);
    });

    it('プラン作成からユーザーへの適用まで一連のフローが成功すること', async () => {
      // === Step 1: Create Plan ===
      const planRequest = createTestPlanRequest({
        displayName: 'E2E Test - Premium Plan',
        description: 'Premium plan for full flow test',
        features: ['feature:premium', 'llm:claude-sonnet'],
        limits: {
          'llm:claude-sonnet': { type: 'daily', count: 50 },
        },
      });

      const createResponse = await apiClient.post<CreatePlanResponse>(
        '/admin/billing/plans',
        planRequest
      );

      expect(createResponse.status).toBe(201);
      const createdPlan = createResponse.data;
      tracker.trackPlan(createdPlan.plan_id);

      // === Step 2: Apply Plan to User ===
      const testUserId = generateTestUserId();
      tracker.trackUser(testUserId);

      const applyResponse = await apiClient.post<ApplyPlanToUserResponse>(
        `/admin/billing/users/${testUserId}/apply-plan`,
        { planId: createdPlan.plan_id }
      );

      expect(applyResponse.status).toBe(200);
      expect(applyResponse.data.userId).toBe(testUserId);
      expect(applyResponse.data.planId).toBe(createdPlan.plan_id);
      expect(applyResponse.data.applicationId).toBeDefined();
      expect(Array.isArray(applyResponse.data.previousApplicationIds)).toBe(
        true
      );
    });

    it('同一プランを複数ユーザーに適用できること', async () => {
      // Create a plan first
      const planRequest = createTestPlanRequest({
        displayName: 'E2E Test - Multi User Plan',
      });

      const createResponse = await apiClient.post<CreatePlanResponse>(
        '/admin/billing/plans',
        planRequest
      );

      expect(createResponse.status).toBe(201);
      tracker.trackPlan(createResponse.data.plan_id);

      // Apply to multiple users
      const userIds = [
        generateTestUserId(),
        generateTestUserId(),
        generateTestUserId(),
      ];
      userIds.forEach((id) => tracker.trackUser(id));

      for (const userId of userIds) {
        const applyResponse = await apiClient.post<ApplyPlanToUserResponse>(
          `/admin/billing/users/${userId}/apply-plan`,
          { planId: createResponse.data.plan_id }
        );

        expect(applyResponse.status).toBe(200);
        expect(applyResponse.data.userId).toBe(userId);
      }
    });
  });

  describe('異常系: プラン作成エラー', () => {
    it('internal_nameが未指定の場合400エラーを返すこと', async () => {
      const response = await apiClient.post<ErrorResponse>(
        '/admin/billing/plans',
        {
          display_name: 'Test Plan',
          platform_type: 'internal',
          permissions: { features: [], limits: {} },
        }
      );

      expect(response.status).toBe(400);
      expect(response.data.code).toBe('MISSING_REQUIRED_FIELD');
    });

    it('display_nameが未指定の場合400エラーを返すこと', async () => {
      const response = await apiClient.post<ErrorResponse>(
        '/admin/billing/plans',
        {
          internal_name: `${E2E_TEST_PREFIX}-missing-display`,
          platform_type: 'internal',
          permissions: { features: [], limits: {} },
        }
      );

      expect(response.status).toBe(400);
      expect(response.data.code).toBe('MISSING_REQUIRED_FIELD');
    });

    it('platform_typeが不正な値の場合400エラーを返すこと', async () => {
      const response = await apiClient.post<ErrorResponse>(
        '/admin/billing/plans',
        {
          internal_name: `${E2E_TEST_PREFIX}-invalid-platform`,
          display_name: 'Test Plan',
          platform_type: 'invalid_type',
          permissions: { features: [], limits: {} },
        }
      );

      expect(response.status).toBe(400);
      expect(response.data.code).toBe('INVALID_FIELD_VALUE');
    });

    it('permissionsが未指定の場合400エラーを返すこと', async () => {
      const response = await apiClient.post<ErrorResponse>(
        '/admin/billing/plans',
        {
          internal_name: `${E2E_TEST_PREFIX}-missing-permissions`,
          display_name: 'Test Plan',
          platform_type: 'internal',
        }
      );

      expect(response.status).toBe(400);
      expect(response.data.code).toBe('MISSING_REQUIRED_FIELD');
    });

    it('internal_nameが重複している場合409エラーを返すこと', async () => {
      // Create first plan
      const planRequest = createTestPlanRequest();
      const firstResponse = await apiClient.post<CreatePlanResponse>(
        '/admin/billing/plans',
        planRequest
      );

      expect(firstResponse.status).toBe(201);
      tracker.trackPlan(firstResponse.data.plan_id);

      // Try to create second plan with same internal_name
      const duplicateResponse = await apiClient.post<ErrorResponse>(
        '/admin/billing/plans',
        {
          ...planRequest,
          display_name: 'Different Display Name',
        }
      );

      expect(duplicateResponse.status).toBe(409);
      expect(duplicateResponse.data.code).toBe('DUPLICATE_INTERNAL_NAME');
    });

    it('stripeプランでplatform_product_idが未指定の場合400エラーを返すこと', async () => {
      const response = await apiClient.post<ErrorResponse>(
        '/admin/billing/plans',
        {
          internal_name: `${E2E_TEST_PREFIX}-stripe-no-product-id`,
          display_name: 'Stripe Plan',
          platform_type: 'stripe',
          permissions: { features: [], limits: {} },
        }
      );

      expect(response.status).toBe(400);
      expect(response.data.code).toBe('MISSING_REQUIRED_FIELD');
    });
  });

  describe('異常系: ユーザーへのプラン適用エラー', () => {
    it('planIdが未指定の場合400エラーを返すこと', async () => {
      const userId = generateTestUserId();
      tracker.trackUser(userId);

      const response = await apiClient.post<ErrorResponse>(
        `/admin/billing/users/${userId}/apply-plan`,
        {}
      );

      expect(response.status).toBe(400);
      expect(response.data.code).toBe('MISSING_PARAMETER');
    });

    it('存在しないプランIDの場合404エラーを返すこと', async () => {
      const userId = generateTestUserId();
      tracker.trackUser(userId);

      const response = await apiClient.post<ErrorResponse>(
        `/admin/billing/users/${userId}/apply-plan`,
        { planId: 'non-existent-plan-id-12345' }
      );

      expect(response.status).toBe(404);
      expect(response.data.code).toBe('PLAN_NOT_FOUND');
    });

    it('非推奨（deprecated）プランの場合400エラーを返すこと', async () => {
      // Create a plan first
      const planRequest = createTestPlanRequest();
      const createResponse = await apiClient.post<CreatePlanResponse>(
        '/admin/billing/plans',
        planRequest
      );

      expect(createResponse.status).toBe(201);
      tracker.trackPlan(createResponse.data.plan_id);

      // First, close to new subscriptions (active → closed_to_new)
      const closeResponse = await apiClient.patch(
        `/admin/billing/plans/${createResponse.data.plan_id}/status`,
        { new_status: 'closed_to_new' }
      );
      expect(closeResponse.status).toBe(200);

      // Then deprecate the plan (closed_to_new → deprecated)
      const deprecateResponse = await apiClient.patch(
        `/admin/billing/plans/${createResponse.data.plan_id}/status`,
        { new_status: 'deprecated' }
      );

      expect(deprecateResponse.status).toBe(200);

      // Try to apply deprecated plan to user
      const userId = generateTestUserId();
      tracker.trackUser(userId);

      const applyResponse = await apiClient.post<ErrorResponse>(
        `/admin/billing/users/${userId}/apply-plan`,
        { planId: createResponse.data.plan_id }
      );

      expect(applyResponse.status).toBe(400);
      expect(applyResponse.data.code).toBe('PLAN_NOT_ACTIVE');
    });
  });

  describe('プランステータス管理', () => {
    it('プランステータスをclosed_to_newに更新できること', async () => {
      // Create a plan
      const planRequest = createTestPlanRequest();
      const createResponse = await apiClient.post<CreatePlanResponse>(
        '/admin/billing/plans',
        planRequest
      );

      expect(createResponse.status).toBe(201);
      tracker.trackPlan(createResponse.data.plan_id);

      // Update status to closed_to_new
      const updateResponse = await apiClient.patch<{
        plan_id: string;
        status: string;
        previous_status: string;
      }>(`/admin/billing/plans/${createResponse.data.plan_id}/status`, {
        new_status: 'closed_to_new',
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.data.status).toBe('closed_to_new');
      expect(updateResponse.data.previous_status).toBe('active');
    });

    it('closed_to_newステータスのプランは新規ユーザーに適用できないこと', async () => {
      // Create a plan
      const planRequest = createTestPlanRequest();
      const createResponse = await apiClient.post<CreatePlanResponse>(
        '/admin/billing/plans',
        planRequest
      );

      expect(createResponse.status).toBe(201);
      tracker.trackPlan(createResponse.data.plan_id);

      // Close to new subscriptions
      const updateResponse = await apiClient.patch(
        `/admin/billing/plans/${createResponse.data.plan_id}/status`,
        { new_status: 'closed_to_new' }
      );

      expect(updateResponse.status).toBe(200);

      // Try to apply to a new user
      const userId = generateTestUserId();
      tracker.trackUser(userId);

      const applyResponse = await apiClient.post<ErrorResponse>(
        `/admin/billing/users/${userId}/apply-plan`,
        { planId: createResponse.data.plan_id }
      );

      expect(applyResponse.status).toBe(400);
      expect(applyResponse.data.code).toBe('PLAN_NOT_ACTIVE');
    });
  });
});
