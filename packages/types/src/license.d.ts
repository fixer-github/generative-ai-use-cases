// License API Types

export type LicensePlan = {
  planId: string;
  name: string;
  monthlyLimit: number;
  enabled: boolean;
  createdDate: string;
  updatedDate: string;
};

export type LicenseUsage = {
  count: number;
  limit: number;
  remaining: number;
  resetDate: string; // 次回リセット日（Asia/Tokyo, 翌月1日）
};

// planId が null = 未割当（無制限）。usage も null。
export type UserLicense = {
  planId: string | null;
  planName: string | null;
  usage: LicenseUsage | null;
};

export type ListLicensePlansResponse = {
  plans: LicensePlan[];
};

export type CreateLicensePlanRequest = {
  name: string;
  monthlyLimit: number;
  enabled?: boolean;
};

export type CreateLicensePlanResponse = {
  plan: LicensePlan;
};

export type UpdateLicensePlanRequest = {
  name?: string;
  monthlyLimit?: number;
  enabled?: boolean;
};

export type UpdateLicensePlanResponse = {
  plan: LicensePlan;
};

export type AssignUserLicenseRequest = {
  planId: string | null; // null で解除
};

export type AssignUserLicenseResponse = {
  license: UserLicense;
};

export type GetUserLicenseResponse = {
  license: UserLicense;
};

export type GetMyLicenseResponse = {
  license: UserLicense;
};
