export interface TenantRegistrationData {
  tenantId: string;
  accountId: string;
  region: string;
  environment: string;
  roleArn?: string;
  bedrockChatApiArn?: string;
}

export interface TenantRegistrationRequest extends TenantRegistrationData {
}

export enum TenantStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PROVISIONING = 'provisioning',
  ERROR = 'error',
}