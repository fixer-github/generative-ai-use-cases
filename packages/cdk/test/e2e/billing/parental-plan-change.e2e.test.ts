/**
 * E2Eテスト: ペアレンタルコントロール - プラン変更フロー
 *
 * テスト対象フロー:
 * 1. 未成年ユーザーが保護者にプラン変更承認リクエストを送信
 * 2. 保護者がメールリンクからプラン変更を承認
 *
 * 注意:
 * - SendGrid API連携のため、テスト用SendGrid設定が必要
 * - DynamoDB (pending-plan-changes) テーブルへのアクセスが必要
 * - 実際のメール送信は環境変数 E2E_SKIP_EMAIL_SEND=true でスキップ可能
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  ApiClient,
  TestCleanupHelper,
  TestResourceTracker,
  TestUserManager,
  SubscriptionTestHelper,
  createTestStripePlanRequest,
  E2E_TEST_PREFIX,
} from '../helpers';
import type { CreatePlanResponse, ErrorResponse } from '../helpers';
import { testConfig } from '../setup';
import {
  DynamoDBClient,
  QueryCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';

/**
 * プラン変更リンク送信レスポンス型
 */
interface SendPlanChangeLinkResponse {
  message: string;
  requestId: string;
  expiresAt: number;
}

/**
 * プラン変更承認レスポンス型
 */
interface ApprovePlanChangeResponse {
  success: boolean;
  message: string;
  flowExecutionId: string;
  changeType: 'upgrade' | 'downgrade';
  effectiveDate: string;
}

/**
 * DynamoDB保留リクエストの型
 */
interface PendingPlanChangeRequest {
  requestId: string;
  approvalToken: string;
  tenantId: string;
  userId: string;
  subscriptionId: string;
  currentPlanId: string;
  newPlanId: string;
  parentEmail: string;
  childEmail: string;
  changeType: 'upgrade' | 'downgrade';
  status: 'pending' | 'approved' | 'expired';
}

/**
 * プラン変更リクエストステータス確認レスポンス型
 */
interface PlanChangeRequestStatusResponse {
  requestId: string;
  status: 'pending' | 'approved' | 'expired';
  changeType: 'upgrade' | 'downgrade';
  newPlanId: string;
  currentPlanId: string;
  createdAt: number;
  expiresAt: number;
  approvedAt?: number;
  effectiveDate?: string;
  flowExecutionId?: string;
}

/**
 * テスト用環境変数
 */
const TEST_STRIPE_PRICE_ID =
  process.env.E2E_TEST_STRIPE_PRICE_ID || 'price_test_placeholder';
const TEST_STRIPE_PRICE_ID_PREMIUM =
  process.env.E2E_TEST_STRIPE_PRICE_ID_PREMIUM ||
  'price_test_premium_placeholder';
const PENDING_PLAN_CHANGES_TABLE = `${testConfig.environment}-pending-plan-changes`;
const SKIP_EMAIL_SEND = process.env.E2E_SKIP_EMAIL_SEND === 'true';

/**
 * DynamoDB Client for test verification
 */
const dynamoDbClient = new DynamoDBClient({});

/**
 * トークンで保留リクエストを検索（テスト検証用）
 */
async function findPendingRequestByRequestId(
  requestId: string
): Promise<PendingPlanChangeRequest | null> {
  try {
    const result = await dynamoDbClient.send(
      new QueryCommand({
        TableName: PENDING_PLAN_CHANGES_TABLE,
        KeyConditionExpression: 'requestId = :requestId',
        ExpressionAttributeValues: {
          ':requestId': { S: requestId },
        },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    const item = result.Items[0];
    return {
      requestId: item.requestId?.S || '',
      approvalToken: item.approvalToken?.S || '',
      tenantId: item.tenantId?.S || '',
      userId: item.userId?.S || '',
      subscriptionId: item.subscriptionId?.S || '',
      currentPlanId: item.currentPlanId?.S || '',
      newPlanId: item.newPlanId?.S || '',
      parentEmail: item.parentEmail?.S || '',
      childEmail: item.childEmail?.S || '',
      changeType: (item.changeType?.S as 'upgrade' | 'downgrade') || 'upgrade',
      status:
        (item.status?.S as 'pending' | 'approved' | 'expired') || 'pending',
    };
  } catch (error) {
    console.error('Error querying pending request:', error);
    return null;
  }
}

/**
 * 保留リクエストを削除（テストクリーンアップ用）
 */
async function deletePendingRequest(requestId: string): Promise<void> {
  try {
    await dynamoDbClient.send(
      new DeleteItemCommand({
        TableName: PENDING_PLAN_CHANGES_TABLE,
        Key: {
          requestId: { S: requestId },
        },
      })
    );
  } catch (error) {
    console.warn('Error deleting pending request:', error);
  }
}

describe('ペアレンタルコントロール - プラン変更フロー E2Eテスト', () => {
  let apiClient: ApiClient;
  let cleanupHelper: TestCleanupHelper;
  let tracker: TestResourceTracker;
  let userManager: TestUserManager;
  let subscriptionHelper: SubscriptionTestHelper;
  let testBasicPlanId: string;
  let testPremiumPlanId: string;
  let createdRequestIds: string[] = [];

  beforeAll(async () => {
    // テスト用管理者ユーザーを作成
    userManager = new TestUserManager();
    const adminUser = await userManager.createAdminUser(testConfig.tenantId);

    // サブスクリプションヘルパーを初期化
    subscriptionHelper = new SubscriptionTestHelper(testConfig.tenantId);

    // APIクライアントを初期化
    apiClient = ApiClient.create(adminUser.token);

    // クリーンアップヘルパーを初期化
    cleanupHelper = new TestCleanupHelper(apiClient);
    tracker = new TestResourceTracker();

    // テスト用Basicプランを作成
    if (TEST_STRIPE_PRICE_ID !== 'price_test_placeholder') {
      const basicPlanRequest = createTestStripePlanRequest(
        TEST_STRIPE_PRICE_ID,
        {
          displayName: `${E2E_TEST_PREFIX} Basic Plan`,
          description: 'Basic plan for parental control E2E testing',
          features: ['feature:basic'],
          limits: {},
        }
      );

      const basicPlanResponse = await apiClient.post<CreatePlanResponse>(
        '/admin/billing/plans',
        basicPlanRequest
      );

      if (basicPlanResponse.status === 201) {
        testBasicPlanId = basicPlanResponse.data.plan_id;
        tracker.trackPlan(testBasicPlanId);
        console.log(`Test Basic plan created: ${testBasicPlanId}`);
      }
    }

    // テスト用Premiumプランを作成
    if (TEST_STRIPE_PRICE_ID_PREMIUM !== 'price_test_premium_placeholder') {
      const premiumPlanRequest = createTestStripePlanRequest(
        TEST_STRIPE_PRICE_ID_PREMIUM,
        {
          displayName: `${E2E_TEST_PREFIX} Premium Plan`,
          description: 'Premium plan for parental control E2E testing',
          features: ['feature:premium', 'feature:unlimited'],
          limits: {},
        }
      );

      const premiumPlanResponse = await apiClient.post<CreatePlanResponse>(
        '/admin/billing/plans',
        premiumPlanRequest
      );

      if (premiumPlanResponse.status === 201) {
        testPremiumPlanId = premiumPlanResponse.data.plan_id;
        tracker.trackPlan(testPremiumPlanId);
        console.log(`Test Premium plan created: ${testPremiumPlanId}`);
      }
    }
  });

  afterEach(async () => {
    // 作成された保留リクエストをクリーンアップ
    for (const requestId of createdRequestIds) {
      await deletePendingRequest(requestId);
    }
    createdRequestIds = [];

    // Stripeサブスクリプションをクリーンアップ
    try {
      await subscriptionHelper.cleanupStripeSubscriptions();
    } catch (error) {
      console.warn('Stripe cleanup error:', error);
    }
  });

  afterAll(async () => {
    // 全テスト完了後にリソースをクリーンアップ
    try {
      await tracker.cleanup(cleanupHelper);
    } catch (error) {
      console.warn('Final cleanup error:', error);
    }

    // テストユーザーをクリーンアップ
    try {
      await userManager.cleanup();
    } catch (error) {
      console.warn('User cleanup error:', error);
    }
  });

  // ============================================================
  // テストケース 1: プラン変更リンク送信API
  // POST /api/subscriptions/send-plan-change-to-parent
  // ============================================================
  describe('テストケース1: プラン変更リンク送信API', () => {
    describe('異常系', () => {
      it('認証なしでリクエストすると401エラーになること', async () => {
        const unauthenticatedClient = ApiClient.create(''); // 空のトークン

        const response = await unauthenticatedClient.post<ErrorResponse>(
          '/api/subscriptions/send-plan-change-to-parent',
          {
            newPlanId: 'test-plan-id',
            parentEmail: 'parent@example.com',
          }
        );

        expect(response.status).toBe(401);
      });

      it('必須パラメータが欠けている場合400エラーになること', async () => {
        const response = await apiClient.post<ErrorResponse>(
          '/api/subscriptions/send-plan-change-to-parent',
          {
            // newPlanId missing
            parentEmail: 'parent@example.com',
          }
        );

        expect(response.status).toBe(400);
        expect(response.data.code).toBe('MISSING_PARAMETER');
      });

      it('無効なメールアドレス形式の場合400エラーになること', async () => {
        const response = await apiClient.post<ErrorResponse>(
          '/api/subscriptions/send-plan-change-to-parent',
          {
            newPlanId: 'test-plan-id',
            parentEmail: 'invalid-email',
          }
        );

        expect(response.status).toBe(400);
        expect(response.data.code).toBe('INVALID_EMAIL');
      });

      it('有効なプランがない場合404エラーになること', async () => {
        const response = await apiClient.post<ErrorResponse>(
          '/api/subscriptions/send-plan-change-to-parent',
          {
            newPlanId: 'non-existent-plan',
            parentEmail: 'parent@example.com',
          }
        );

        // ユーザーにアクティブなサブスクリプションがない場合
        expect([404, 400]).toContain(response.status);
      });
    });

    // 正常系テストはサブスクリプションのセットアップが必要なため、
    // 統合テスト環境でのみ実行
    describe.skipIf(!testBasicPlanId || !testPremiumPlanId)(
      '正常系（要サブスクリプション）',
      () => {
        it('プラン変更リクエストが正常に作成されること', async () => {
          // このテストは実際のサブスクリプションセットアップが必要
          // TODO: サブスクリプション作成後にテスト実行
        });
      }
    );
  });

  // ============================================================
  // テストケース 2: プラン変更承認API
  // POST /api/subscriptions/approve-plan-change
  // ============================================================
  describe('テストケース2: プラン変更承認API（公開エンドポイント）', () => {
    describe('異常系', () => {
      it('トークンがない場合400エラーになること', async () => {
        // 公開エンドポイントなので認証なしでリクエスト可能
        const unauthenticatedClient = ApiClient.create('');

        const response = await unauthenticatedClient.post<ErrorResponse>(
          '/api/subscriptions/approve-plan-change',
          {}
        );

        expect(response.status).toBe(400);
        expect(response.data.code).toBe('MISSING_TOKEN');
      });

      it('無効なトークンの場合400エラーになること', async () => {
        const unauthenticatedClient = ApiClient.create('');

        const response = await unauthenticatedClient.post<ErrorResponse>(
          '/api/subscriptions/approve-plan-change',
          {
            token: 'invalid-token-12345',
          }
        );

        expect(response.status).toBe(400);
        expect(response.data.code).toBe('INVALID_TOKEN');
      });
    });
  });

  // ============================================================
  // テストケース 3: プラン変更リクエストステータス確認API
  // GET /api/subscriptions/plan-change-request/{requestId}/status
  // ============================================================
  describe('テストケース3: プラン変更リクエストステータス確認API', () => {
    describe('異常系', () => {
      it('認証なしでリクエストすると401エラーになること', async () => {
        const unauthenticatedClient = ApiClient.create('');

        const response = await unauthenticatedClient.get<ErrorResponse>(
          '/api/subscriptions/plan-change-request/test-request-id/status'
        );

        expect(response.status).toBe(401);
      });

      it('存在しないリクエストIDの場合404エラーになること', async () => {
        const response = await apiClient.get<ErrorResponse>(
          '/api/subscriptions/plan-change-request/non-existent-request-id/status'
        );

        expect(response.status).toBe(404);
        expect(response.data.code).toBe('REQUEST_NOT_FOUND');
      });
    });
  });
});
