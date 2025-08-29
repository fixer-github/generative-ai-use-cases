// Define the type of Feature Flag
export type FeatureFlags = {
  // Model Feature Flags
  text?: boolean;
  doc?: boolean;
  image?: boolean;
  video?: boolean;
  reasoning?: boolean;

  image_gen?: boolean;
  video_gen?: boolean;

  embedding?: boolean;
  reranking?: boolean;

  speechToSpeech?: boolean;

  // Additional Flags
  light?: boolean;
  legacy?: boolean;
};

export type ModelConfiguration = {
  modelId: string;
  region: string;
};

export type ModelMetadata = {
  flags: FeatureFlags;
  displayName: string;
};

export type ModelData = {
  modelId: string;
  type: string; // TODO: 今後`provider`への名前変更を検討
  displayName: string;
  features: FeatureFlags;
};
