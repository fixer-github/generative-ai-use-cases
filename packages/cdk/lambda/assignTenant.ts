import { PreSignUpTriggerEvent, Context, Callback } from 'aws-lambda';

interface TenantMapEntry {
  tenantId: string;
  domains?: string[];
  emails?: string[];
}

const TENANT_MAP_STR = process.env.SELF_SIGNUP_TENANT_MAP || '[]';
const TENANT_MAP: TenantMapEntry[] = JSON.parse(TENANT_MAP_STR);

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

exports.handler = async (
  event: PreSignUpTriggerEvent,
  _context: Context,
  callback: Callback
) => {
  try {
    console.log('Received event:', JSON.stringify(event, null, 2));
    const email = event.request.userAttributes.email;
    const tenantId = findTenantId(email);
    if (tenantId) {
      event.request.userAttributes['custom:tenant_id'] = tenantId;
      callback(null, event);
    } else if (TENANT_MAP.length === 0) {
      callback(null, event);
    } else {
      callback(new Error('Unknown tenant'));
    }
  } catch (error) {
    console.log('Error ocurred:', error);
    if (error instanceof Error) {
      callback(error);
    } else {
      callback(new Error('An unknown error occurred.'));
    }
  }
};
