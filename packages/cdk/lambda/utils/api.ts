import bedrockAgentApi from './bedrockAgentApi';
import bedrockApi from './bedrockApi';
import bedrockKbApi from './bedrockKbApi';
import liteLlmApi from './liteLlmApi';
import sagemakerApi from './sagemakerApi';

const api = {
  bedrock: bedrockApi,
  bedrockAgent: bedrockAgentApi,
  bedrockKb: bedrockKbApi,
  sagemaker: sagemakerApi,
  liteLlm: liteLlmApi,
};

export default api;
