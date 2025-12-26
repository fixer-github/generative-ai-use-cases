/**
 * ユーザプラン適用テーブルへのデータアクセス用Lambda関数
 *
 * VPC内に配置され、RDSへの直接アクセスを行います。
 * ビジネスロジック層（VPC外）からLambda-to-Lambda呼び出しで使用されます。
 */

import { UserPlanApplicationRepository } from './repositories/userPlanApplicationRepository';
import { getRdsConnectionForVpc } from './getRdsConnectionForVpc';
import { UserPlanApplication } from './repositories/types';

/**
 * サポートする操作の型定義
 */
export type UserPlanApplicationDataAccessOperation =
  | 'create'
  | 'findById'
  | 'findAll'
  | 'findAllPaginated'
  | 'findByUserId'
  | 'findActiveByUserId'
  | 'findByApplicationSourceId'
  | 'findExpiringSoon'
  | 'findScheduledTermination'
  | 'findSubscriptionApplicationByUserId'
  | 'update'
  | 'scheduleTermination'
  | 'expire'
  | 'extendValidity'
  | 'createWithTransaction'; // トランザクション処理用の複合操作

/**
 * Lambda関数の入力イベント
 */
export interface UserPlanApplicationDataAccessEvent {
  operation: UserPlanApplicationDataAccessOperation;
  params: any;
  tenantId: string;
}

/**
 * ページネーション付きの結果
 */
export interface PaginatedResult {
  items: UserPlanApplication[];
  total_count: number;
}

/**
 * トランザクション結果
 */
export interface TransactionResult {
  newApplication: UserPlanApplication;
  expiredApplications: UserPlanApplication[];
}

/**
 * Lambda関数の出力
 */
export interface UserPlanApplicationDataAccessResponse {
  success: boolean;
  data?: UserPlanApplication | UserPlanApplication[] | PaginatedResult | TransactionResult | null;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * エラークラス
 */
export class UserPlanApplicationDataAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'UserPlanApplicationDataAccessError';
  }
}

/**
 * Lambda handler
 */
export const handler = async (
  event: UserPlanApplicationDataAccessEvent
): Promise<UserPlanApplicationDataAccessResponse> => {
  console.log(
    'user-plan-application-data-access event:',
    JSON.stringify(event, null, 2)
  );

  try {
    // 入力バリデーション
    if (!event.operation || !event.tenantId) {
      throw new UserPlanApplicationDataAccessError(
        'INVALID_INPUT',
        'operation and tenantId are required',
        { operation: event.operation, tenantId: event.tenantId }
      );
    }

    // VPC内でRDS接続設定を取得（環境変数から）
    const rdsConfig = await getRdsConnectionForVpc(event.tenantId);
    const userPlanApplicationRepository = new UserPlanApplicationRepository(rdsConfig);

    // 操作を実行
    let result:
      | UserPlanApplication
      | UserPlanApplication[]
      | PaginatedResult
      | TransactionResult
      | null = null;

    switch (event.operation) {
      case 'create':
        validateCreateParams(event.params);
        result = await userPlanApplicationRepository.create(
          convertDateFields(event.params)
        );
        break;

      case 'findById':
        if (!event.params?.applicationId) {
          throw new UserPlanApplicationDataAccessError(
            'INVALID_PARAMS',
            'applicationId is required'
          );
        }
        result = await userPlanApplicationRepository.findById(
          event.params.applicationId
        );
        break;

      case 'findAll':
        result = await userPlanApplicationRepository.findAll(event.params || {});
        break;

      case 'findAllPaginated':
        result = await userPlanApplicationRepository.findAllPaginated(event.params || {});
        break;

      case 'findByUserId':
        if (!event.params?.userId) {
          throw new UserPlanApplicationDataAccessError(
            'INVALID_PARAMS',
            'userId is required'
          );
        }
        result = await userPlanApplicationRepository.findByUserId(event.params.userId);
        break;

      case 'findActiveByUserId':
        if (!event.params?.userId) {
          throw new UserPlanApplicationDataAccessError(
            'INVALID_PARAMS',
            'userId is required'
          );
        }
        result = await userPlanApplicationRepository.findActiveByUserId(
          event.params.userId
        );
        break;

      case 'findByApplicationSourceId':
        if (!event.params?.sourceId) {
          throw new UserPlanApplicationDataAccessError(
            'INVALID_PARAMS',
            'sourceId is required'
          );
        }
        result = await userPlanApplicationRepository.findByApplicationSourceId(
          event.params.sourceId
        );
        break;

      case 'findExpiringSoon':
        if (!event.params?.thresholdDate) {
          throw new UserPlanApplicationDataAccessError(
            'INVALID_PARAMS',
            'thresholdDate is required'
          );
        }
        const thresholdDate = new Date(event.params.thresholdDate);
        if (isNaN(thresholdDate.getTime())) {
          throw new UserPlanApplicationDataAccessError(
            'INVALID_PARAMS',
            'Invalid thresholdDate format'
          );
        }
        result = await userPlanApplicationRepository.findExpiringSoon(thresholdDate);
        break;

      case 'findScheduledTermination':
        result = await userPlanApplicationRepository.findScheduledTermination();
        break;

      case 'findSubscriptionApplicationByUserId':
        if (!event.params?.userId) {
          throw new UserPlanApplicationDataAccessError(
            'INVALID_PARAMS',
            'userId is required'
          );
        }
        result = await userPlanApplicationRepository.findSubscriptionApplicationByUserId(
          event.params.userId
        );
        break;

      case 'update':
        if (!event.params?.applicationId || !event.params?.updates) {
          throw new UserPlanApplicationDataAccessError(
            'INVALID_PARAMS',
            'applicationId and updates are required'
          );
        }
        result = await userPlanApplicationRepository.update(
          event.params.applicationId,
          convertDateFields(event.params.updates)
        );
        break;

      case 'scheduleTermination':
        if (!event.params?.applicationId) {
          throw new UserPlanApplicationDataAccessError(
            'INVALID_PARAMS',
            'applicationId is required'
          );
        }
        result = await userPlanApplicationRepository.scheduleTermination(
          event.params.applicationId
        );
        break;

      case 'expire':
        if (!event.params?.applicationId) {
          throw new UserPlanApplicationDataAccessError(
            'INVALID_PARAMS',
            'applicationId is required'
          );
        }
        result = await userPlanApplicationRepository.expire(
          event.params.applicationId
        );
        break;

      case 'extendValidity':
        if (!event.params?.applicationId || !event.params?.newValidUntil) {
          throw new UserPlanApplicationDataAccessError(
            'INVALID_PARAMS',
            'applicationId and newValidUntil are required'
          );
        }
        const newValidUntil = new Date(event.params.newValidUntil);
        if (isNaN(newValidUntil.getTime())) {
          throw new UserPlanApplicationDataAccessError(
            'INVALID_PARAMS',
            'Invalid newValidUntil format'
          );
        }
        result = await userPlanApplicationRepository.extendValidity(
          event.params.applicationId,
          newValidUntil
        );
        break;

      case 'createWithTransaction':
        // トランザクション内で複数のプラン適用を処理する複合操作
        // 例：既存のプランを期限切れにして新しいプランを適用
        result = await handleCreateWithTransaction(
          userPlanApplicationRepository,
          event.params
        );
        break;

      default:
        throw new UserPlanApplicationDataAccessError(
          'INVALID_OPERATION',
          `Unsupported operation: ${event.operation}`
        );
    }

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    console.error('Error in user-plan-application-data-access:', error);

    if (error instanceof UserPlanApplicationDataAccessError) {
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
    throw new UserPlanApplicationDataAccessError(
      'INVALID_PARAMS',
      'params is required'
    );
  }

  const requiredFields = [
    'user_id',
    'plan_id',
    'application_source',
    'application_status',
    'valid_from',
  ];

  for (const field of requiredFields) {
    if (params[field] === undefined) {
      throw new UserPlanApplicationDataAccessError(
        'INVALID_PARAMS',
        `${field} is required for create operation`
      );
    }
  }

  // application_sourceの検証
  const validSources = ['subscription', 'default', 'trial', 'campaign', 'manual'];
  if (!validSources.includes(params.application_source)) {
    throw new UserPlanApplicationDataAccessError(
      'INVALID_PARAMS',
      `Invalid application_source: ${params.application_source}`
    );
  }

  // application_statusの検証
  const validStatuses = ['active', 'scheduled_termination', 'expired'];
  if (!validStatuses.includes(params.application_status)) {
    throw new UserPlanApplicationDataAccessError(
      'INVALID_PARAMS',
      `Invalid application_status: ${params.application_status}`
    );
  }

  // 日付フィールドの検証
  const validFrom = new Date(params.valid_from);
  if (isNaN(validFrom.getTime())) {
    throw new UserPlanApplicationDataAccessError(
      'INVALID_PARAMS',
      'Invalid valid_from format'
    );
  }

  if (params.valid_until) {
    const validUntil = new Date(params.valid_until);
    if (isNaN(validUntil.getTime())) {
      throw new UserPlanApplicationDataAccessError(
        'INVALID_PARAMS',
        'Invalid valid_until format'
      );
    }

    if (validUntil <= validFrom) {
      throw new UserPlanApplicationDataAccessError(
        'INVALID_PARAMS',
        'valid_until must be after valid_from'
      );
    }
  }
}

/**
 * 日付フィールドをDateオブジェクトに変換する
 */
function convertDateFields(params: any): any {
  const converted = { ...params };

  if (converted.valid_from) {
    converted.valid_from = new Date(converted.valid_from);
  }

  if (converted.valid_until) {
    converted.valid_until = new Date(converted.valid_until);
  }

  return converted;
}

/**
 * トランザクション内で複数のプラン適用を処理する
 *
 * 既存の有効なプラン適用を期限切れにして、新しいプラン適用を作成する
 */
async function handleCreateWithTransaction(
  repository: UserPlanApplicationRepository,
  params: {
    userId: string;
    newApplication: Omit<
      UserPlanApplication,
      'application_id' | 'created_at' | 'updated_at'
    >;
    expireExisting?: boolean;
  }
): Promise<{
  newApplication: UserPlanApplication;
  expiredApplications: UserPlanApplication[];
}> {
  if (!params.userId || !params.newApplication) {
    throw new UserPlanApplicationDataAccessError(
      'INVALID_PARAMS',
      'userId and newApplication are required for createWithTransaction'
    );
  }

  const expiredApplications: UserPlanApplication[] = [];

  // 既存の有効なプラン適用を期限切れにする場合
  if (params.expireExisting) {
    const activeApplications = await repository.findActiveByUserId(params.userId);

    for (const activeApp of activeApplications) {
      const expired = await repository.expire(activeApp.application_id);
      if (expired) {
        expiredApplications.push(expired);
      }
    }
  }

  // 新しいプラン適用を作成
  validateCreateParams(params.newApplication);
  const newApplication = await repository.create(
    convertDateFields(params.newApplication)
  );

  return {
    newApplication,
    expiredApplications,
  };
}