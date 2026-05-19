// Admin API Types

export type AdminUser = {
  username: string;
  email: string;
  status: string;
  enabled: boolean;
  groups: string[];
  createdDate: string;
  lastModifiedDate: string;
};

export type ListUsersResponse = {
  users: AdminUser[];
  paginationToken?: string;
};

export type CreateUserRequest = {
  email: string;
  groups?: string[];
};

export type CreateUserResponse = {
  user: AdminUser;
};

export type DisableUserRequest = {
  username: string;
};

export type EnableUserRequest = {
  username: string;
};

export type DeleteUserRequest = {
  username: string;
};

export type UpdateUserGroupsRequest = {
  username: string;
  groups: string[];
};

export type PasswordPolicy = {
  minimumLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSymbols: boolean;
};

export type GetPasswordPolicyResponse = {
  policy: PasswordPolicy;
};

export type UpdatePasswordPolicyRequest = {
  policy: PasswordPolicy;
};

export type UpdatePasswordPolicyResponse = {
  policy: PasswordPolicy;
};
