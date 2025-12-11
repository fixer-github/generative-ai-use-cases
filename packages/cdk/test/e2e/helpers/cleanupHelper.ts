/**
 * Cleanup Helper for E2E Tests
 *
 * Provides cleanup for test data using API calls (soft deletion via deprecation).
 * - Plans: deprecated via API (soft delete)
 * - User Plan Applications: remain in database but isolated by test user IDs
 *
 * Test data is identified by the E2E_TEST_PREFIX in internal_name/user_id.
 */

import { ApiClient } from './apiClient';

/**
 * Helper class for cleaning up test data via API
 *
 * NOTE: This class is NOT a singleton to avoid parallel test execution issues.
 * Each test suite should create its own instance.
 */
export class TestCleanupHelper {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Deprecate a plan by ID (soft delete)
   * First closes to new subscriptions, then deprecates
   */
  async deprecatePlan(planId: string): Promise<boolean> {
    try {
      // First try to close to new (active -> closed_to_new)
      const closeResponse = await this.apiClient.patch(
        `/admin/billing/plans/${planId}/status`,
        { new_status: 'closed_to_new' }
      );

      if (closeResponse.status !== 200) {
        // Plan might already be closed_to_new or deprecated
        console.log(`Plan ${planId} may already be closed, attempting deprecation...`);
      }

      // Then deprecate (closed_to_new -> deprecated)
      const deprecateResponse = await this.apiClient.patch(
        `/admin/billing/plans/${planId}/status`,
        { new_status: 'deprecated' }
      );

      if (deprecateResponse.status === 200) {
        console.log(`Deprecated plan: ${planId}`);
        return true;
      } else {
        // Plan might already be deprecated
        console.log(`Plan ${planId} deprecation returned status ${deprecateResponse.status} (may already be deprecated)`);
        return true;
      }
    } catch (error) {
      console.warn(`Error deprecating plan ${planId}:`, error);
      return false;
    }
  }

  /**
   * Deprecate multiple plans by ID
   */
  async deprecatePlans(planIds: string[]): Promise<void> {
    for (const planId of planIds) {
      await this.deprecatePlan(planId);
    }
  }

  /**
   * Clean up plans created during tests (soft delete via deprecation)
   * This is a best-effort cleanup - errors are logged but don't fail
   */
  async cleanupTestPlans(planIds: string[]): Promise<void> {
    if (planIds.length === 0) {
      return;
    }

    console.log(`Cleaning up ${planIds.length} test plans (deprecating)...`);
    await this.deprecatePlans(planIds);
  }

  /**
   * Note: User plan applications cannot be directly deleted or expired via API.
   * They will remain in the database but are associated with deprecated plans
   * and isolated by test user IDs (E2E_TEST_PREFIX).
   */
  async cleanupUserPlanApplications(userIds: string[]): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    console.log(
      `Note: ${userIds.length} user plan applications remain in database (isolated by test user IDs).`
    );
  }
}

/**
 * Track created resources for cleanup
 */
export class TestResourceTracker {
  private planIds: string[] = [];
  private userIds: string[] = [];

  /**
   * Track a created plan ID
   */
  trackPlan(planId: string): void {
    this.planIds.push(planId);
  }

  /**
   * Track a created user ID
   */
  trackUser(userId: string): void {
    this.userIds.push(userId);
  }

  /**
   * Get tracked plan IDs
   */
  getPlanIds(): string[] {
    return [...this.planIds];
  }

  /**
   * Get tracked user IDs
   */
  getUserIds(): string[] {
    return [...this.userIds];
  }

  /**
   * Clear tracked resources
   */
  clear(): void {
    this.planIds = [];
    this.userIds = [];
  }

  /**
   * Cleanup all tracked resources
   */
  async cleanup(helper: TestCleanupHelper): Promise<void> {
    await helper.cleanupTestPlans(this.planIds);
    await helper.cleanupUserPlanApplications(this.userIds);
    this.clear();
  }
}
