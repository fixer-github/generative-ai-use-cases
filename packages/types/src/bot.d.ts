export type BotEntity = {
  id: string;
  createdDate: string;
  userId: string;
  title: string;
  description: string;
  promptTemplate: string;
  publicInOrg: boolean;
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
