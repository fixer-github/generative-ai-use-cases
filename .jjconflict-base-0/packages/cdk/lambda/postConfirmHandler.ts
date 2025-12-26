/**
 * Post Confirmation統合ハンドラー
 *
 * Cognito POST_CONFIRMATIONトリガーから呼び出され、
 * 1. テナント割り当て
 * 2. ユーザー登録メタデータの保存（clientMetadataがある場合）
 * 3. デフォルトプラン適用
 * を順番に実行します。
 */

import { PostConfirmationTriggerEvent } from 'aws-lambda';
import { SelfSignUpTenantMapEntry } from 'generative-ai-use-cases';
import { assignTenantToUser } from './assignTenant';
import { applyDefaultPlanToUser } from './applyDefaultPlanToUser';
import { saveUserRegistrationMetadata } from './saveUserRegistrationMetadata';

/**
 * POST_CONFIRMATIONトリガーのメインハンドラー
 */
exports.handler = async (event: PostConfirmationTriggerEvent): Promise<PostConfirmationTriggerEvent> => {
  console.log('postConfirmHandler - Starting POST_CONFIRMATION processing');
  console.log('Event:', JSON.stringify(event, null, 2));

  // パスワードリセット時はデフォルトプラン適用をスキップ
  // POST_CONFIRMATIONトリガーは新規登録時(PostConfirmation_ConfirmSignUp)と
  // パスワードリセット時(PostConfirmation_ConfirmForgotPassword)の両方で発火するため、
  // パスワードリセット時は既存のプランを上書きしないようにする
  if (event.triggerSource === 'PostConfirmation_ConfirmForgotPassword') {
    console.log('postConfirmHandler - Skipping processing for ConfirmForgotPassword (password reset)');
    return event;
  }

  try {
    // 環境変数からテナントマップを取得
    const TENANT_MAP_STR = process.env.SELF_SIGNUP_TENANT_MAP || '[]';
    const TENANT_MAP: SelfSignUpTenantMapEntry[] = JSON.parse(TENANT_MAP_STR);

    // Step 1: テナント割り当て
    console.log('postConfirmHandler - Step 1: Assigning tenant');
    const eventAfterTenant = await assignTenantToUser(event, TENANT_MAP);

    // テナントIDを取得（割り当て後のカスタム属性から取得）
    let tenantId: string | undefined;

    // assignTenantToUserは既存のevent構造を変更しないため、
    // テナントIDはemailアドレスから再度判定する必要がある
    const email = event.request.userAttributes.email;
    if (email) {
      const lowerEmail = email.toLowerCase();
      const domain = lowerEmail.split('@')[1];

      for (const entry of TENANT_MAP) {
        // "*" をワイルドカードとして扱い、すべてのドメインをこのテナントに割り当て
        if (entry.domains && entry.domains.includes('*')) {
          tenantId = entry.tenantId;
          break;
        }
        if (entry.emails && entry.emails.includes(lowerEmail)) {
          tenantId = entry.tenantId;
          break;
        }
        if (entry.domains && entry.domains.includes(domain)) {
          tenantId = entry.tenantId;
          break;
        }
      }
    }

    // Step 2: ユーザー登録メタデータの保存（clientMetadataがある場合）
    // テナント割り当てやプラン適用の成否に関係なく実行する
    console.log('postConfirmHandler - Step 2: Saving user registration metadata');
    const metadataSaved = await saveUserRegistrationMetadata(event);

    if (metadataSaved) {
      console.log('postConfirmHandler - User registration metadata saved successfully');
    } else {
      console.warn('postConfirmHandler - Failed to save user registration metadata, but continuing user registration');
      // メタデータの保存に失敗してもユーザー登録は続行する
    }

    if (!tenantId) {
      if (TENANT_MAP.length === 0) {
        console.log('postConfirmHandler - No tenant map configured, skipping default plan application');
        return eventAfterTenant;
      }
      console.warn('postConfirmHandler - Could not determine tenant ID, skipping default plan application');
      return eventAfterTenant;
    }

    // Step 3: デフォルトプラン適用
    console.log(`postConfirmHandler - Step 3: Applying default plan for tenant ${tenantId}`);
    const planApplied = await applyDefaultPlanToUser(eventAfterTenant, tenantId);

    if (planApplied) {
      console.log('postConfirmHandler - Default plan applied successfully');
    } else {
      console.warn('postConfirmHandler - Failed to apply default plan, but continuing user registration');
      // デフォルトプランの適用に失敗してもユーザー登録は続行する
    }

    console.log('postConfirmHandler - POST_CONFIRMATION processing completed successfully');
    return eventAfterTenant;
  } catch (error) {
    console.error('postConfirmHandler - Fatal error during POST_CONFIRMATION processing:', error);
    // テナント割り当てエラーは致命的なので、エラーを再スローする
    throw error;
  }
};