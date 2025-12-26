/**
 * プランテーブルへのデータアクセス用Lambda関数
 *
 * VPC内に配置され、RDSへの直接アクセスを行います。
 * ビジネスロジック層（VPC外）からLambda-to-Lambda呼び出しで使用されます。
 */

import { PlanRepository } from './repositories/planRepository';
import { getRdsConnectionForVpc } from './getRdsConnectionForVpc';
import { Plan } from './repositories/types';

/**
 * サポートする操作の型定義
 */
export type PlanDataAccessOperation =
  | 'create'
  | 'findById'
  | 'findByInternalName'
  | 'findByPlatformProductId'
  | 'findAll'
  | 'findByPlatformAndStatus'
  | 'findActiveByPlatform'
  | 'update'
  | 'deprecate'
  | 'getDefaultPlan'
  | 'setDefaultPlan';

/**
 * Lambda関数の入力イベント
 */
export interface PlanDataAccessEvent {
  operation: PlanDataAccessOperation;
  params: any;
  tenantId: string;
}

/**
 * Lambda関数の出力
 */
export interface PlanDataAccessResponse {
  success: boolean;
  data?: Plan | Plan[] | null;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * エラークラス
 */
export class PlanDataAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'PlanDataAccessError';
  }
}

/**
 * Lambda handler
 */
export const handler = async (
  event: PlanDataAccessEvent
): Promise<PlanDataAccessResponse> => {
  console.log('plan-data-access event:', JSON.stringify(event, null, 2));

  try {
    // 入力バリデーション
    if (!event.operation || !event.tenantId) {
      throw new PlanDataAccessError(
        'INVALID_INPUT',
        'operation and tenantId are required',
        { operation: event.operation, tenantId: event.tenantId }
      );
    }

    // VPC内でRDS接続設定を取得（環境変数から）
    const rdsConfig = await getRdsConnectionForVpc(event.tenantId);
    const planRepository = new PlanRepository(rdsConfig);

    // 操作を実行
    let result: Plan | Plan[] | null = null;

    switch (event.operation) {
      case 'create':
        validateCreateParams(event.params);
        result = await planRepository.create(event.params);
        break;

      case 'findById':
        if (!event.params?.id) {
          throw new PlanDataAccessError('INVALID_PARAMS', 'id is required');
        }
        result = await planRepository.findById(event.params.id);
        break;

      case 'findByInternalName':
        if (!event.params?.internalName) {
          throw new PlanDataAccessError(
            'INVALID_PARAMS',
            'internalName is required'
          );
        }
        result = await planRepository.findByInternalName(
          event.params.internalName
        );
        break;

      case 'findByPlatformProductId':
        if (!event.params?.platformProductId) {
          throw new PlanDataAccessError(
            'INVALID_PARAMS',
            'platformProductId is required'
          );
        }
        result = await planRepository.findByPlatformProductId(
          event.params.platformProductId
        );
        break;

      case 'findAll':
        result = await planRepository.findAll(event.params || {});
        break;

      case 'findByPlatformAndStatus':
        if (!event.params?.platformType || !event.params?.status) {
          throw new PlanDataAccessError(
            'INVALID_PARAMS',
            'platformType and status are required'
          );
        }
        result = await planRepository.findByPlatformAndStatus(
          event.params.platformType,
          event.params.status
        );
        break;

      case 'findActiveByPlatform':
        if (!event.params?.platformType) {
          throw new PlanDataAccessError(
            'INVALID_PARAMS',
            'platformType is required'
          );
        }
        result = await planRepository.findActiveByPlatform(
          event.params.platformType
        );
        break;

      case 'update':
        if (!event.params?.planId || !event.params?.updates) {
          throw new PlanDataAccessError(
            'INVALID_PARAMS',
            'planId and updates are required'
          );
        }
        result = await planRepository.update(
          event.params.planId,
          event.params.updates
        );
        break;

      case 'deprecate':
        if (!event.params?.planId) {
          throw new PlanDataAccessError('INVALID_PARAMS', 'planId is required');
        }
        result = await planRepository.deprecate(event.params.planId);
        break;

      case 'getDefaultPlan':
        result = await planRepository.getDefaultPlan();
        break;

      case 'setDefaultPlan':
        if (!event.params?.planId) {
          throw new PlanDataAccessError('INVALID_PARAMS', 'planId is required');
        }
        result = await planRepository.setDefaultPlan(event.params.planId);
        break;

      default:
        throw new PlanDataAccessError(
          'INVALID_OPERATION',
          `Unsupported operation: ${event.operation}`
        );
    }

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    console.error('Error in plan-data-access:', error);

    if (error instanceof PlanDataAccessError) {
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
    throw new PlanDataAccessError('INVALID_PARAMS', 'params is required');
  }

  const requiredFields = [
    'internal_name',
    'display_name',
    'platform_type',
    'permissions',
    'status',
  ];

  for (const field of requiredFields) {
    if (params[field] === undefined) {
      throw new PlanDataAccessError(
        'INVALID_PARAMS',
        `${field} is required for create operation`
      );
    }
  }

  // platform_typeの検証
  const validPlatformTypes = ['stripe', 'apple', 'google', 'internal'];
  if (!validPlatformTypes.includes(params.platform_type)) {
    throw new PlanDataAccessError(
      'INVALID_PARAMS',
      `Invalid platform_type: ${params.platform_type}`
    );
  }

  // statusの検証
  const validStatuses = ['active', 'closed_to_new', 'deprecated'];
  if (!validStatuses.includes(params.status)) {
    throw new PlanDataAccessError(
      'INVALID_PARAMS',
      `Invalid status: ${params.status}`
    );
  }
}
