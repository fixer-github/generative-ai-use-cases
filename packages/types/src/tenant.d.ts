import type { HiddenUseCases } from './useCases';

export type SelfSignUpTenantMapEntry = {
  tenantId: string;
  domains?: string[];
  emails?: string[];
};

export type TenantConfiguration = {
  tenantId: string;
  tenantDisplayName: string;
  hiddenFeatures: HiddenUseCases;
};
