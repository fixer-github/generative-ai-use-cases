/**
 * LiteLLM Configuration Types
 */

export interface LiteLLMConfig {
  providers: LiteLLMProviders;
  kms?: LiteLLMKmsConfig;
  virtualKeys?: LiteLLMVirtualKeyConfig;
}

export interface LiteLLMProviders {
  openai?: LiteLLMProvider;
  anthropic?: LiteLLMProvider;
  bedrock?: LiteLLMProvider;
  azure?: LiteLLMAzureProvider;
  google?: LiteLLMProvider;
  cohere?: LiteLLMProvider;
  replicate?: LiteLLMProvider;
  huggingface?: LiteLLMProvider;
}

export interface LiteLLMProvider {
  enabled: boolean;
  secretKey?: string;
  modelPrefix?: string;
  useIAMRole?: boolean;
}

export interface LiteLLMAzureProvider extends LiteLLMProvider {
  endpoint?: string;
  apiVersion?: string;
}

export interface LiteLLMKmsConfig {
  keyAlias: string;
  enableKeyRotation: boolean;
  pendingWindowInDays: number;
  enableAuditLog?: boolean;
  secretRotationDays?: number;
}

export interface LiteLLMVirtualKeyConfig {
  enabled: boolean;
  prefix: string;
  defaultExpiry: number;
  maxKeysPerUser?: number;
  keyPattern?: string;
}

export interface LiteLLMModelConfig {
  model_name: string;
  litellm_params: LiteLLMModelParams;
  model_info?: LiteLLMModelInfo;
}

export interface LiteLLMModelParams {
  model: string;
  api_key?: string;
  api_base?: string;
  api_version?: string;
  aws_region_name?: string;
  custom_llm_provider?: string;
}

export interface LiteLLMModelInfo {
  max_tokens?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  supports_function_calling?: boolean;
  supports_streaming?: boolean;
}

export interface LiteLLMRouterSettings {
  routing_strategy:
    | 'least-cost'
    | 'least-latency'
    | 'round-robin'
    | 'usage-based';
  enable_fallbacks: boolean;
  fallback_models: string[];
  model_group_config?: Record<string, LiteLLMModelGroupConfig>;
}

export interface LiteLLMModelGroupConfig {
  rpm?: number; // Requests per minute
  tpm?: number; // Tokens per minute
  max_parallel_requests?: number;
}

export interface LiteLLMSecuritySettings {
  validate_requests: boolean;
  allowed_ips?: string[];
  rate_limiting?: LiteLLMRateLimiting;
  content_filtering?: LiteLLMContentFiltering;
}

export interface LiteLLMRateLimiting {
  enabled: boolean;
  default_rpm: number;
  default_tpm: number;
  per_user_limits?: Record<string, { rpm: number; tpm: number }>;
}

export interface LiteLLMContentFiltering {
  enabled: boolean;
  block_prompts_containing?: string[];
  block_responses_containing?: string[];
  custom_filters?: string[];
}

export interface LiteLLMVirtualKey {
  key: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  models?: string[];
  metadata?: Record<string, any>;
  usage?: LiteLLMKeyUsage;
}

export interface LiteLLMKeyUsage {
  total_requests: number;
  total_tokens: number;
  total_cost: number;
  last_used_at?: string;
  models_used: Record<string, number>;
}

export interface LiteLLMProxyRequest {
  model: string;
  messages: LiteLLMMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  stream?: boolean;
  user?: string;
  metadata?: Record<string, any>;
}

export interface LiteLLMMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
}

export interface LiteLLMProxyResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: LiteLLMChoice[];
  usage?: LiteLLMUsage;
  system_fingerprint?: string;
}

export interface LiteLLMChoice {
  index: number;
  message: LiteLLMMessage;
  finish_reason: 'stop' | 'length' | 'function_call' | 'content_filter' | null;
  logprobs?: any;
}

export interface LiteLLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface LiteLLMError {
  error: {
    message: string;
    type: string;
    param?: string;
    code?: string;
    status_code?: number;
    llm_provider?: string;
  };
}
