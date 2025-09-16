export type BotEntity = {
  id: string;
  createdDate: string;
  userId: string;
  title: string;
  description: string;
  promptTemplate: string;
  publicInOrg: boolean;
  inputExamples: BotInputExample[];
  useFixedModel: boolean;
  modelId: string;
  fileAttachEnabled: boolean;
  knouledgeFiles: BotKnouledgeFileEntity[];
};

export type BotKnouledgeFileEntity = {
  name: string;
  key: string;
};

export type BotCreateRequest = {
  title: string;
  description: string;
  promptTemplate: string;
  publicInOrg: boolean;
  inputExamples: BotCreateRequestInputExample[];
  useFixedModel: boolean;
  modelId: string;
  fileAttachEnabled: boolean;
  knouledgeFiles: BotCreateRequestKnouledgeFile[];
};

export type BotCreateRequestKnouledgeFile = {
  name: string;
  contentType: string;
  content: string;
};

export type BotCreateResponse = {
  id: string;
  title: string;
  description: string;
};

export type BotUpsertRequest = {
  id: string;
  title: string;
  description: string;
  promptTemplate: string;
  publicInOrg: boolean;
  inputExamples: BotUpsertRequestInputExample[];
  useFixedModel: boolean;
  modelId: string;
  fileAttachEnabled: boolean;
};

export type BotUpsertResponse = {
  id: string;
};

export type BotListResponse = {
  items: BotListResponseItem[];
};

export type BotListResponseItem = {
  id: string;
  userId: string;
  title: string;
  description: string;
  publicInOrg: boolean;
};

export type BotGetResponse = {
  id: string;
  userId: string;
  title: string;
  description: string;
  promptTemplate: string;
  publicInOrg: boolean;
  inputExamples: BotGetResponseInputExample[];
  useFixedModel: boolean;
  modelId: string;
  fileAttachEnabled: boolean;
};

export type BotInputExample = {
  title: string;
  examples: Record<string, string>;
};

export type BotCreateRequestInputExample = BotInputExample;
export type BotUpsertRequestInputExample = BotInputExample;
export type BotGetResponseInputExample = BotInputExample;
