import useHttp from './useHttp';
import {
  ListLicensePlansResponse,
  CreateLicensePlanRequest,
  CreateLicensePlanResponse,
  UpdateLicensePlanRequest,
  UpdateLicensePlanResponse,
  AssignUserLicenseRequest,
  AssignUserLicenseResponse,
  GetUserLicenseResponse,
  GetMyLicenseResponse,
} from 'generative-ai-use-cases';

const useLicenseApi = () => {
  const http = useHttp();

  return {
    // --- Admin: License Plan CRUD ---

    listLicensePlans: () => {
      return http.get<ListLicensePlansResponse>('/admin/license/plans');
    },

    createLicensePlan: async (req: CreateLicensePlanRequest) => {
      const res = await http.post<
        CreateLicensePlanResponse,
        CreateLicensePlanRequest
      >('/admin/license/plans', req);
      return res.data;
    },

    updateLicensePlan: async (
      planId: string,
      req: UpdateLicensePlanRequest
    ) => {
      const res = await http.put<
        UpdateLicensePlanResponse,
        UpdateLicensePlanRequest
      >(`/admin/license/plans/${encodeURIComponent(planId)}`, req);
      return res.data;
    },

    deleteLicensePlan: async (planId: string) => {
      await http.delete(`/admin/license/plans/${encodeURIComponent(planId)}`);
    },

    // --- Admin: User License Assignment ---

    getUserLicense: (username: string | null) => {
      return http.get<GetUserLicenseResponse>(
        username ? `/admin/users/${encodeURIComponent(username)}/license` : null
      );
    },

    assignUserLicense: async (
      username: string,
      req: AssignUserLicenseRequest
    ) => {
      const res = await http.put<
        AssignUserLicenseResponse,
        AssignUserLicenseRequest
      >(`/admin/users/${encodeURIComponent(username)}/license`, req);
      return res.data;
    },

    // --- Self-service ---

    getMyLicense: () => {
      // For the remaining-count badge: the counter advances on each chat, so refetch periodically
      return http.get<GetMyLicenseResponse>('/license/me', {
        refreshInterval: 60_000,
        revalidateOnFocus: true,
      });
    },
  };
};

export default useLicenseApi;
