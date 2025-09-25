import bedrockApi from './bedrockApi';
import bedrockAgentApi from './bedrockAgentApi';
import bedrockKbApi from './bedrockKbApi';
import sagemakerApi from './sagemakerApi';
import liteLlmApi from './liteLlmApi';
import langchainApi from './langchainApi';
import chatbotApi from './chatbotApi';

const api = {
  bedrock: bedrockApi,
  bedrockAgent: bedrockAgentApi,
  bedrockKb: bedrockKbApi,
  sagemaker: sagemakerApi,
  liteLlm: liteLlmApi,
  langchain: langchainApi,
  chatbot: chatbotApi,
};

export default api;
