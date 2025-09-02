import { PostConfirmationTriggerEvent } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';

interface TenantMapEntry {
  tenantId: string;
  domains?: string[];
  emails?: string[];
}

const TENANT_MAP_STR = process.env.SELF_SIGNUP_TENANT_MAP || '[]';
const TENANT_MAP: TenantMapEntry[] = JSON.parse(TENANT_MAP_STR);
const USER_POOL_ID = process.env.USER_POOL_ID;

const cognito = new CognitoIdentityProviderClient({});

const findTenantId = (email: string): string | null => {
  if (email.split('@').length !== 2) {
    return null;
  }
  const domain = email.split('@')[1];
  for (const entry of TENANT_MAP) {
    if (entry.emails && entry.emails.includes(email)) {
      return entry.tenantId;
    }
    if (entry.domains && entry.domains.includes(domain)) {
      return entry.tenantId;
    }
  }
  return null;
};

exports.handler = async (event: PostConfirmationTriggerEvent) => {
  try {
    console.log('Received event:', JSON.stringify(event, null, 2));
    const email = event.request.userAttributes.email;
    const tenantId = findTenantId(email);
    if (!tenantId) {
      if (TENANT_MAP.length === 0) {
        return event;
      }
      throw new Error('Unknown tenant');
    }
    if (!USER_POOL_ID) {
      throw new Error('USER_POOL_ID is not set');
    }
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: event.userName,
        UserAttributes: [{ Name: 'custom:tenant_id', Value: tenantId }],
      })
    );
    return event;
  } catch (error) {
    console.log('Error occurred:', error);
    throw error;
  }
};
