import { PostConfirmationTriggerEvent } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SelfSignUpTenantMapEntry } from 'generative-ai-use-cases';

const cognito = new CognitoIdentityProviderClient({});

const findTenantId = (email: string, tenantMap: SelfSignUpTenantMapEntry[]): string | null => {
  if (email.split('@').length !== 2) {
    return null;
  }
  const lowerEmail = email.toLowerCase();
  const domain = lowerEmail.split('@')[1];
  for (const entry of tenantMap) {
    if (entry.emails && entry.emails.includes(lowerEmail)) {
      return entry.tenantId;
    }
    if (entry.domains && entry.domains.includes(domain)) {
      return entry.tenantId;
    }
  }
  return null;
};

/**
 * テナントをユーザーに割り当てる関数
 * @param event - Cognito Post Confirmationイベント
 * @param tenantMap - テナントマップ設定
 * @returns 処理済みのイベント
 */
export async function assignTenantToUser(
  event: PostConfirmationTriggerEvent,
  tenantMap: SelfSignUpTenantMapEntry[]
): Promise<PostConfirmationTriggerEvent> {
  try {
    console.log('assignTenantToUser - Received event:', JSON.stringify(event, null, 2));
    const email = event.request.userAttributes.email;
    const tenantId = findTenantId(email, tenantMap);

    if (!tenantId) {
      if (tenantMap.length === 0) {
        console.log('assignTenantToUser - No tenant map configured, skipping tenant assignment');
        return event;
      }
      throw new Error('Unknown tenant');
    }

    console.log(`assignTenantToUser - Assigning tenant ${tenantId} to user ${event.userName}`);

    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
        UserAttributes: [{ Name: 'custom:tenant_id', Value: tenantId }],
      })
    );

    console.log('assignTenantToUser - Tenant assigned successfully');
    return event;
  } catch (error) {
    console.error('assignTenantToUser - Error occurred:', error);
    throw error;
  }
}

// 既存のLambdaハンドラー（後方互換性のため残す）
exports.handler = async (event: PostConfirmationTriggerEvent) => {
  const TENANT_MAP_STR = process.env.SELF_SIGNUP_TENANT_MAP || '[]';
  const TENANT_MAP: SelfSignUpTenantMapEntry[] = JSON.parse(TENANT_MAP_STR);

  return assignTenantToUser(event, TENANT_MAP);
};
