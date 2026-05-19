import useHttp from './useHttp';
import {
  ListUsersResponse,
  CreateUserRequest,
  CreateUserResponse,
  UpdateUserGroupsRequest,
  GetPasswordPolicyResponse,
  UpdatePasswordPolicyRequest,
  UpdatePasswordPolicyResponse,
} from 'generative-ai-use-cases';

const useAdminApi = () => {
  const http = useHttp();

  return {
    listUsers: (paginationToken?: string) => {
      const params = paginationToken
        ? `?paginationToken=${encodeURIComponent(paginationToken)}`
        : '';
      return http.get<ListUsersResponse>(`/admin/users${params}`);
    },

    createUser: async (req: CreateUserRequest) => {
      const res = await http.post<CreateUserResponse, CreateUserRequest>(
        '/admin/users',
        req
      );
      return res.data;
    },

    disableUser: async (username: string) => {
      await http.post(
        `/admin/users/${encodeURIComponent(username)}/disable`,
        {}
      );
    },

    enableUser: async (username: string) => {
      await http.post(
        `/admin/users/${encodeURIComponent(username)}/enable`,
        {}
      );
    },

    deleteUser: async (username: string) => {
      await http.delete(`/admin/users/${encodeURIComponent(username)}`);
    },

    updateUserGroups: async (username: string, groups: string[]) => {
      const res = await http.put<
        { username: string; groups: string[] },
        UpdateUserGroupsRequest
      >(`/admin/users/${encodeURIComponent(username)}/groups`, {
        username,
        groups,
      });
      return res.data;
    },

    getPasswordPolicy: () => {
      return http.get<GetPasswordPolicyResponse>('/admin/password-policy');
    },

    updatePasswordPolicy: async (req: UpdatePasswordPolicyRequest) => {
      const res = await http.put<
        UpdatePasswordPolicyResponse,
        UpdatePasswordPolicyRequest
      >('/admin/password-policy', req);
      return res.data;
    },
  };
};

export default useAdminApi;
