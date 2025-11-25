/**
 * サブスクリプションテーブルへのデータアクセス用Lambda関数
 *
 * VPC内に配置され、RDSへの直接アクセスを行います。
 * ビジネスロジック層（VPC外）からLambda-to-Lambda呼び出しで使用されます。
 */

import { SubscriptionRepository } from './repositories/subscriptionRepository';
import { getRdsConnectionForVpc } from './getRdsConnectionForVpc';
import { Subscription } from './repositories/types';

/**
 * サポートする操作の型定義
 */
export type SubscriptionDataAccessOperation =
  | 'create'
  | 'findById'
  | 'findByPlatformSubscriptionId'
  | 'findByUserId'
  | 'findByUserIdAndStatus'
  | 'findActiveByUserId'
  | 'findPendingVerification'
  | 'findExpiringSoon'
  | 'update'
  | 'cancel'
  | 'scheduleCancel'
  | 'extendPeriod'
  | 'getStatistics'
  | 'findAllForAdmin'
  | 'findByIdWithDetails';

/**
 * Lambda関数の入力イベント
 */
export interface SubscriptionDataAccessEvent {
  operation: SubscriptionDataAccessOperation;
  params: any;
  tenantId: string;
}

/**
 * Lambda関数の出力
 */
export interface SubscriptionDataAccessResponse {
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * エラークラス
 */
export class SubscriptionDataAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'SubscriptionDataAccessError';
  }
}

/**
 * Lambda handler
 */
export const handler = async (
  event: SubscriptionDataAccessEvent
): Promise<SubscriptionDataAccessResponse> => {
  console.log(
    'subscription-data-access event:',
    JSON.stringify(event, null, 2)
  );

  try {
    // 入力バリデーション
    if (!event.operation || !event.tenantId) {
      throw new SubscriptionDataAccessError(
        'INVALID_INPUT',
        'operation and tenantId are required',
        { operation: event.operation, tenantId: event.tenantId }
      );
    }

    // VPC内でRDS接続設定を取得（環境変数から）
    const rdsConfig = await getRdsConnectionForVpc(event.tenantId);
    const subscriptionRepository = new SubscriptionRepository(rdsConfig);

    // 操作を実行
    let result: any = null;

    switch (event.operation) {
      case 'create':
        validateCreateParams(event.params);
        // 日付フィールドをDate型に変換
        const subscriptionData = {
          ...event.params,
          current_period_start: new Date(event.params.current_period_start),
          current_period_end: new Date(event.params.current_period_end)
        };
        result = await subscriptionRepository.create(subscriptionData);
        break;

      case 'findById':
        if (!event.params?.subscriptionId) {
          throw new SubscriptionDataAccessError(
            'INVALID_PARAMS',
            'subscriptionId is required'
          );
        }
        result = await subscriptionRepository.findById(
          event.params.subscriptionId
        );
        break;

      case 'findByPlatformSubscriptionId':
        if (!event.params?.platformSubscriptionId) {
          throw new SubscriptionDataAccessError(
            'INVALID_PARAMS',
            'platformSubscriptionId is required'
          );
        }
        result = await subscriptionRepository.findByPlatformSubscriptionId(
          event.params.platformSubscriptionId
        );
        break;

      case 'findByUserId':
        if (!event.params?.userId) {
          throw new SubscriptionDataAccessError(
            'INVALID_PARAMS',
            'userId is required'
          );
        }
        result = await subscriptionRepository.findByUserId(event.params.userId);
        break;

      case 'findByUserIdAndStatus':
        if (!event.params?.userId || !event.params?.status) {
          throw new SubscriptionDataAccessError(
            'INVALID_PARAMS',
            'userId and status are required'
          );
        }
        result = await subscriptionRepository.findByUserIdAndStatus(
          event.params.userId,
          event.params.status
        );
        break;

      case 'findActiveByUserId':
        if (!event.params?.userId) {
          throw new SubscriptionDataAccessError(
            'INVALID_PARAMS',
            'userId is required'
          );
        }
        result = await subscriptionRepository.findActiveByUserId(
          event.params.userId
        );
        break;

      case 'findPendingVerification':
        result = await subscriptionRepository.findPendingVerification();
        break;

      case 'findExpiringSoon':
        if (!event.params?.thresholdDate) {
          throw new SubscriptionDataAccessError(
            'INVALID_PARAMS',
            'thresholdDate is required'
          );
        }
        const thresholdDate = new Date(event.params.thresholdDate);
        if (isNaN(thresholdDate.getTime())) {
          throw new SubscriptionDataAccessError(
            'INVALID_PARAMS',
            'Invalid thresholdDate format'
          );
        }
        result = await subscriptionRepository.findExpiringSoon(thresholdDate);
        break;

      case 'update':
        if (!event.params?.subscriptionId || !event.params?.updates) {
          throw new SubscriptionDataAccessError(
            'INVALID_PARAMS',
            'subscriptionId and updates are required'
          );
        }
        // 日付フィールドの変換
        const updates = { ...event.params.updates };
        if (updates.current_period_start) {
          updates.current_period_start = new Date(updates.current_period_start);
        }
        if (updates.current_period_end) {
          updates.current_period_end = new Date(updates.current_period_end);
        }
        result = await subscriptionRepository.update(
          event.params.subscriptionId,
          updates
        );
        break;

      case 'cancel':
        if (!event.params?.subscriptionId) {
          throw new SubscriptionDataAccessError(
            'INVALID_PARAMS',
            'subscriptionId is required'
          );
        }
        result = await subscriptionRepository.cancel(
          event.params.subscriptionId
        );
        break;

      case 'scheduleCancel':
        if (!event.params?.subscriptionId) {
          throw new SubscriptionDataAccessError(
            'INVALID_PARAMS',
            'subscriptionId is required'
          );
        }
        result = await subscriptionRepository.scheduleCancel(
          event.params.subscriptionId
        );
        break;

      case 'extendPeriod':
        if (
          !event.params?.subscriptionId ||
          !event.params?.newPeriodStart ||
          !event.params?.newPeriodEnd
        ) {
          throw new SubscriptionDataAccessError(
            'INVALID_PARAMS',
            'subscriptionId, newPeriodStart and newPeriodEnd are required'
          );
        }
        const newPeriodStart = new Date(event.params.newPeriodStart);
        const newPeriodEnd = new Date(event.params.newPeriodEnd);
        if (isNaN(newPeriodStart.getTime()) || isNaN(newPeriodEnd.getTime())) {
          throw new SubscriptionDataAccessError(
            'INVALID_PARAMS',
            'Invalid date format for newPeriodStart or newPeriodEnd'
          );
        }
        result = await subscriptionRepository.extendPeriod(
          event.params.subscriptionId,
          newPeriodStart,
          newPeriodEnd
        );
        break;

      case 'getStatistics':
        result = await subscriptionRepository.getStatistics();
        break;

      case 'findAllForAdmin':
        // 日付フィールドの変換（存在する場合）
        const adminOptions = { ...event.params };
        if (adminOptions.periodStartFrom) {
          adminOptions.periodStartFrom = new Date(adminOptions.periodStartFrom);
        }
        if (adminOptions.periodStartTo) {
          adminOptions.periodStartTo = new Date(adminOptions.periodStartTo);
        }
        if (adminOptions.createdAtFrom) {
          adminOptions.createdAtFrom = new Date(adminOptions.createdAtFrom);
        }
        if (adminOptions.createdAtTo) {
          adminOptions.createdAtTo = new Date(adminOptions.createdAtTo);
        }
        result = await subscriptionRepository.findAllForAdmin(
          adminOptions || {}
        );
        break;

      case 'findByIdWithDetails':
        if (!event.params?.subscriptionId) {
          throw new SubscriptionDataAccessError(
            'INVALID_PARAMS',
            'subscriptionId is required'
          );
        }
        result = await subscriptionRepository.findByIdWithDetails(
          event.params.subscriptionId
        );
        break;

      default:
        throw new SubscriptionDataAccessError(
          'INVALID_OPERATION',
          `Unsupported operation: ${event.operation}`
        );
    }

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    console.error('Error in subscription-data-access:', error);

    if (error instanceof SubscriptionDataAccessError) {
      return {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
};

/**
 * create操作のパラメータバリデーション
 */
function validateCreateParams(params: any): void {
  if (!params) {
    throw new SubscriptionDataAccessError(
      'INVALID_PARAMS',
      'params is required'
    );
  }

  const requiredFields = [
    'user_id',
    'plan_id',
    'platform_type',
    'platform_subscription_id',
    'subscription_status',
    'current_period_start',
    'current_period_end',
    'cancel_at_period_end',
  ];

  for (const field of requiredFields) {
    if (params[field] === undefined) {
      throw new SubscriptionDataAccessError(
        'INVALID_PARAMS',
        `${field} is required for create operation`
      );
    }
  }

  // platform_typeの検証
  const validPlatformTypes = ['stripe', 'apple', 'google'];
  if (!validPlatformTypes.includes(params.platform_type)) {
    throw new SubscriptionDataAccessError(
      'INVALID_PARAMS',
      `Invalid platform_type: ${params.platform_type}`
    );
  }

  // subscription_statusの検証
  const validStatuses = [
    'active',
    'paused',
    'pending_verification',
    'canceled',
    'expired',
  ];
  if (!validStatuses.includes(params.subscription_status)) {
    throw new SubscriptionDataAccessError(
      'INVALID_PARAMS',
      `Invalid subscription_status: ${params.subscription_status}`
    );
  }

  // 日付フィールドの検証
  const periodStart = new Date(params.current_period_start);
  const periodEnd = new Date(params.current_period_end);
  if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
    throw new SubscriptionDataAccessError(
      'INVALID_PARAMS',
      'Invalid date format for current_period_start or current_period_end'
    );
  }

  if (periodEnd <= periodStart) {
    throw new SubscriptionDataAccessError(
      'INVALID_PARAMS',
      'current_period_end must be after current_period_start'
    );
  }
}
