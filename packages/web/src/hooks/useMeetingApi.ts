import {
  CreateMeetingRequest,
  CreateMeetingResponse,
  ListMeetingsResponse,
  FindMeetingByIdResponse,
  UpdateMeetingRequest,
  UpdateMeetingResponse,
} from 'generative-ai-use-cases';
import useHttp from './useHttp';

// Client for the meeting (minutes) workbench backend (/meetings). The
// MeetingTable is the source of truth; create/update also write a Chat
// projection row so the sidebar history lists meetings. find/update take a bare
// meetingId (no `meeting#` prefix), matching the findChatById/updateTitle
// convention.
const useMeetingApi = () => {
  const http = useHttp();
  return {
    createMeeting: async (
      req: CreateMeetingRequest
    ): Promise<CreateMeetingResponse> => {
      const res = await http.post('meetings', req);
      return res.data;
    },
    listMeetings: () => {
      const getKey = (
        pageIndex: number,
        previousPageData: ListMeetingsResponse
      ) => {
        if (previousPageData && !previousPageData.lastEvaluatedKey) return null;
        if (pageIndex === 0) return 'meetings';
        return `meetings?exclusiveStartKey=${previousPageData.lastEvaluatedKey}`;
      };
      return http.getPagination<ListMeetingsResponse>(getKey, {
        revalidateIfStale: false,
      });
    },
    findMeetingById: (meetingId?: string) => {
      return http.get<FindMeetingByIdResponse>(
        meetingId ? `meetings/${meetingId}` : null
      );
    },
    updateMeeting: async (
      meetingId: string,
      req: UpdateMeetingRequest
    ): Promise<UpdateMeetingResponse> => {
      const res = await http.put<UpdateMeetingResponse>(
        `meetings/${meetingId}`,
        req
      );
      return res.data;
    },
    deleteMeeting: (meetingId: string) => {
      return http.delete<void>(`meetings/${meetingId}`);
    },
  };
};

export default useMeetingApi;
