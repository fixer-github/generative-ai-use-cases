import {
  Model,
  RecordedMessage,
  ToBeRecordedMessage,
  UnrecordedMessage,
  Metadata,
} from './message';
import { Chat } from './chat';
import {
  Meeting,
  MeetingSource,
  MeetingTranscript,
  MeetingMinutesDoc,
} from './meeting';
import { SystemContext } from './systemContext';
import {
  QueryCommandOutput,
  RetrieveCommandOutput,
} from '@aws-sdk/client-kendra';
import { StopReason } from '@aws-sdk/client-bedrock-runtime';
import {
  FlowInputContent,
  RetrieveCommandOutput as RetrieveCommandOutputKnowledgeBase,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { GenerateImageParams } from './image';
import { GenerateVideoParams, VideoJob } from './video';
import { ShareId, UserIdAndChatId } from './share';

export type StreamingChunk = {
  text: string;
  trace?: string;
  metadata?: Metadata;
  stopReason?: StopReason | 'error';
  sessionId?: string;
};

export type Pagination<T> = {
  data: T[];
  lastEvaluatedKey?: string;
};

export type CreateChatResponse = {
  chat: Chat;
};

export type CreateMessagesRequest = {
  messages: ToBeRecordedMessage[];
};

export type CreateMessagesResponse = {
  messages: RecordedMessage[];
};

export type ListChatsResponse = Pagination<Chat>;

export type FindChatByIdResponse = {
  chat: Chat;
};

export type ListMessagesResponse = {
  messages: RecordedMessage[];
};

// Meeting (議事録) workbench
export type CreateMeetingRequest = {
  title?: string;
  source: MeetingSource;
};

export type CreateMeetingResponse = {
  meeting: Meeting;
};

export type ListMeetingsResponse = Pagination<Meeting>;

export type FindMeetingByIdResponse = {
  meeting: Meeting | null;
  // Resolved S3 bodies (when the corresponding key is set). The workbench reads
  // these on open; they are not stored on the DynamoDB item.
  transcript?: MeetingTranscript | null;
  minutes?: MeetingMinutesDoc | null;
};

// DynamoDB-attribute patch, plus optional S3 bodies. When `transcript` /
// `minutes` are present the lambda writes them to S3 and sets the matching
// key (transcriptKey / minutesKey) on the item; they are never stored inline.
export type UpdateMeetingRequest = Partial<
  Pick<
    Meeting,
    | 'title'
    | 'status'
    | 'jobName'
    | 'transcriptKey'
    | 'minutesKey'
    | 'audioKey'
    | 'speakers'
    | 'rev'
    | 'genRev'
  >
> & {
  transcript?: MeetingTranscript;
  minutes?: MeetingMinutesDoc;
};

export type UpdateMeetingResponse = {
  meeting: Meeting;
};

export type CreateSystemContextRequest = {
  systemContext: SystemContext;
};

export type UpdateSystemContextTitleRequest = {
  title: string;
};

export type UpdateSystemContextTitleResponse = {
  systemContext: SystemContext;
};

export type UpdateFeedbackRequest = {
  createdDate: string;
  feedback: string;
  reasons?: string[];
  detailedFeedback?: string;
};

export type UpdateFeedbackResponse = {
  message: RecordedMessage;
};

export type UpdateTitleRequest = {
  title: string;
};

export type UpdateTitleResponse = {
  chat: Chat;
};

export type PredictRequest = {
  model?: Model;
  idToken?: string;
  messages: UnrecordedMessage[];
  id: string;
  webSearchEnabled?: boolean;
};

export type PredictResponse = string;

// New UI (GaiXer medical) top-page agent auto-suggestion.
// Sends the user's free-text query and candidate agents (id/name/description),
// and the LLM picks up to 3 matches via a lightweight synchronous endpoint
// (/predict/agent-suggest). See the top-page implementation memo (s2/s7).
export type AgentSuggestRequest = {
  query: string;
  agents: { id: string; name: string; description: string }[];
};

export type AgentSuggestResponse = {
  // Matched agents (up to 3, best first). Empty array means no match.
  matches: { id: string; reason: string }[];
};

export type FlowRequest = {
  flowIdentifier: string;
  flowAliasIdentifier: string;
  document: FlowInputContent.DocumentMember['document'];
};

export type OptimizePromptRequest = {
  prompt: string;
  targetModelId: string;
};

export type PredictTitleRequest = {
  model: Model;
  chat: Chat;
  prompt: string;
  id: string;
};

export type PredictTitleResponse = string;

export type QueryKendraRequest = {
  query: string;
};

export type QueryKendraResponse = QueryCommandOutput;

export type RetrieveKendraRequest = {
  query: string;
};

export type RetrieveKendraResponse = RetrieveCommandOutput;

export type RetrieveKnowledgeBaseRequest = {
  query: string;
};

export type RetrieveKnowledgeBaseResponse = RetrieveCommandOutputKnowledgeBase;

export type S3Type = 'default' | 'knowledgeBase' | 'agentcore';

export type BucketInfo = {
  bucketName: string;
  region: string;
};

export type GetFileDownloadSignedUrlRequest = {
  bucketName: string;
  filePrefix: string;
  region?: string;
  contentType?: string;
  s3Type?: S3Type;
};

export type GetFileDownloadSignedUrlResponse = string;

export type GenerateImageRequest = {
  model?: Model;
  params: GenerateImageParams;
};
export type GenerateImageResponse = string;

export type GenerateVideoRequest = {
  model?: Model;
  params: GenerateVideoParams;
};

export type GenerateVideoResponse = VideoJob;

export type ListVideoJobsResponse = Pagination<VideoJob>;

export type DeleteFileRequest = {
  fileName: string;
};
export type DeleteFileResponse = null;

export type StartTranscriptionRequest = {
  audioUrl: string;
  speakerLabel: boolean;
  maxSpeakers: number;
  languageCode?: string;
};

export type StartTranscriptionResponse = {
  jobName: string;
};

export type Transcript = {
  speakerLabel?: string;
  transcript: string;
  // Segment timestamps in seconds. Streaming (useMicrophone) already keeps
  // these; batch (getTranscription) now preserves them too. Required by the
  // workbench for evidence links, waveform, and proportional time splitting.
  startTime?: number;
  endTime?: number;
};

export type GetTranscriptionResponse = {
  status: string;
  languageCode: string;
  transcripts?: Transcript[];
};

export type UploadAudioRequest = {
  file: File;
};

export type WebTextRequest = {
  url: string;
};

export type WebTextResponse = {
  text: string;
};

export type CreateShareIdResponse = {
  shareId: ShareId;
  userIdAndChatId: UserIdAndChatId;
};

export type FindShareIdResponse = ShareId;

export type GetSharedChatResponse = {
  chat: Chat;
  messages: RecordedMessage[];
};

export type GetFileUploadSignedUrlRequest = {
  filename?: string;
  mediaFormat: string;
};

export type GetFileUploadSignedUrlResponse = string;

export type UploadFileRequest = {
  file: File;
};
