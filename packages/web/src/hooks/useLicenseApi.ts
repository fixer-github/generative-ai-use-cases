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
  GetLicenseUsageSummaryResponse,
  GetMyLicenseResponse,
  StartTranscribeSessionRequest,
  StartTranscribeSessionResponse,
  ReportTranscribeSessionRequest,
  ReportTranscribeSessionResponse,
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

    // --- Admin: Usage summary (per-user remaining % + exhausted count) ---

    getLicenseUsageSummary: () => {
      return http.get<GetLicenseUsageSummaryResponse>(
        '/admin/license/usage-summary',
        { refreshInterval: 60_000 }
      );
    },

    // --- Self-service ---

    getMyLicense: () => {
      // The remaining % advances with each use; refetch periodically
      return http.get<GetMyLicenseResponse>('/license/me', {
        refreshInterval: 60_000,
        revalidateOnFocus: true,
      });
    },

    // --- Realtime transcription metering ---

    startTranscribeSession: async (req: StartTranscribeSessionRequest) => {
      const res = await http.post<
        StartTranscribeSessionResponse,
        StartTranscribeSessionRequest
      >('/license/transcribe/start', req);
      return res.data;
    },

    reportTranscribeSession: async (req: ReportTranscribeSessionRequest) => {
      const res = await http.post<
        ReportTranscribeSessionResponse,
        ReportTranscribeSessionRequest
      >('/license/transcribe/report', req);
      return res.data;
    },
  };
};

export default useLicenseApi;
