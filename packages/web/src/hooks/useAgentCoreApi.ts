import { useCallback } from 'react';
import useChat from './useChat';
import useChatApi from './useChatApi';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
  InvokeAgentRuntimeCommandInput,
} from '@aws-sdk/client-bedrock-agentcore';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';
import { fetchAuthSession } from 'aws-amplify/auth';
import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import {
  AgentCoreRequest,
  AgentCoreLlmCallEvent,
  Model,
  UnrecordedMessage,
  StrandsContentBlock,
  AgentCoreRuntimeRequest,
} from 'generative-ai-use-cases';
import {
  StrandsStreamProcessor,
  convertToStrandsFormat,
  convertFilesToStrandsContentBlocks,
} from '../utils/strandsUtils';
import {
  attachAgentObservabilityToMessages,
  saveAgentObservabilityCompletionBestEffort,
  startAgentRunBestEffort,
} from '../utils/agentObservabilityUtils';
import { getRegionFromArn } from '../utils/arnUtils';
import useAppNotificationStore from './useAppNotificationStore';

// Get environment variables
const region = import.meta.env.VITE_APP_REGION as string;
const modelRegion = import.meta.env.VITE_APP_MODEL_REGION as string;
const identityPoolId = import.meta.env.VITE_APP_IDENTITY_POOL_ID as string;
const userPoolId = import.meta.env.VITE_APP_USER_POOL_ID as string;
const cognitoIdentityPoolProxyEndpoint = import.meta.env
  .VITE_APP_COGNITO_IDENTITY_POOL_PROXY_ENDPOINT;

const useAgentCoreApi = (id: string) => {
  const {
    loading,
    setLoading,
    pushMessage,
    popMessage,
    createChatIfNotExist,
    addChunkToAssistantMessage,
    addMessageIdsToUnrecordedMessages,
    replaceMessages,
    setPredictedTitle,
  } = useChat(id);
  const {
    createMessages,
    startAgentRun,
    completeAgentRun,
    appendAgentLlmCalls,
  } = useChatApi();

  // Create a stream processor instance that maintains state across chunks
  const streamProcessor = useCallback(() => new StrandsStreamProcessor(), []);

  // Process a chunk of Strands event data and add it to the assistant message.
  // onLlmCall collects observability llm_call events (cross-repo observability contract §3.2) without
  // affecting the rendered message.
  const processChunk = useCallback(
    (
      eventText: string,
      model: Model,
      processor: StrandsStreamProcessor,
      onLlmCall?: (llmCall: AgentCoreLlmCallEvent) => void
    ) => {
      const processed = processor.processEvent(eventText);

      if (processed) {
        if (processed.appNotification) {
          useAppNotificationStore
            .getState()
            .pushNotification(processed.appNotification);
        }
        if (processed.llmCall && onLlmCall) {
          onLlmCall(processed.llmCall);
        }
        if (processed.text || processed.trace || processed.metadata) {
          addChunkToAssistantMessage(
            processed.text || '',
            processed.trace || undefined,
            model,
            processed.metadata
          );
        }
      }
    },
    [addChunkToAssistantMessage]
  );

  // Convert messages to Strands format
  const convertMessagesToStrandsFormat = useCallback(
    (messages: UnrecordedMessage[]) => {
      return convertToStrandsFormat(messages);
    },
    []
  );

  const postMessage = useCallback(
    async (req: AgentCoreRuntimeRequest) => {
      setLoading(true);
      let isFirstChunk = true;
      const startedAt = new Date().toISOString();

      // Create a new stream processor for this request
      const processor = streamProcessor();

      // Observability (cross-repo observability contract §3.2): collect llm_call events from the stream.
      // PR1 only collects and logs them; persistence via GenU API is added in PR2.
      const llmCalls: AgentCoreLlmCallEvent[] = [];
      const collectLlmCall = (llmCall: AgentCoreLlmCallEvent) => {
        llmCalls.push(llmCall);
      };

      try {
        await startAgentRunBestEffort({
          apis: { startAgentRun },
          agentRunId: req.agentRunId,
          agentId: req.agentId,
          sessionId: req.sessionId,
          startedAt,
        });

        pushMessage('user', req.prompt);
        pushMessage('assistant', 'Thinking...');

        // Get the ID token from the authenticated user
        const token = (await fetchAuthSession()).tokens?.idToken?.toString();
        if (!token) {
          throw new Error('User is not authenticated');
        }

        const clientRegion = getRegionFromArn(req.agentRuntimeArn) || region;

        // Create the Cognito Identity client
        const cognito = new CognitoIdentityClient({
          region,
          ...(cognitoIdentityPoolProxyEndpoint
            ? { endpoint: cognitoIdentityPoolProxyEndpoint }
            : {}),
        });
        const providerName = `cognito-idp.${region}.amazonaws.com/${userPoolId}`;

        // Create the BedrockAgentCore client with the determined region
        const client = new BedrockAgentCoreClient({
          region: clientRegion,
          credentials: fromCognitoIdentityPool({
            client: cognito,
            identityPoolId,
            logins: {
              [providerName]: token,
            },
          }),
        });

        // Convert previous messages to Strands format if provided
        const strandsMessages = req.previousMessages
          ? convertMessagesToStrandsFormat(req.previousMessages)
          : [];

        // Process files if provided and convert them to Strands content blocks
        const promptBlocks: StrandsContentBlock[] = [{ text: req.prompt }];

        if (req.files && req.files.length > 0) {
          try {
            const fileContentBlocks = await convertFilesToStrandsContentBlocks(
              req.files
            );
            promptBlocks.push(...fileContentBlocks);
          } catch (error) {
            console.error(
              'Error converting files to Strands content blocks:',
              error
            );
          }
        }

        // Create the request with the exact schema: messages, systemPrompt, prompt, model, and optional fields
        const agentCoreRequest: AgentCoreRequest = {
          messages: strandsMessages,
          system_prompt: req.system_prompt || '',
          prompt: promptBlocks,
          model: {
            type: 'bedrock',
            modelId:
              req.model.modelId ||
              'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
            region: req.model.region || modelRegion,
          },
          ...(req.userId && { user_id: req.userId }),
          ...(req.mcpServers && { mcp_servers: req.mcpServers }),
          ...(req.agentId && { agent_id: req.agentId }),
          ...(req.agentRunId && { agent_run_id: req.agentRunId }),
          ...(req.sessionId && { session_id: req.sessionId }),
          ...(req.codeExecutionEnabled !== undefined && {
            code_execution_enabled: req.codeExecutionEnabled,
          }),
        };

        console.log(
          'AgentCoreRequest payload:',
          JSON.stringify(agentCoreRequest, null, 2)
        );

        const commandInput: InvokeAgentRuntimeCommandInput = {
          agentRuntimeArn: req.agentRuntimeArn,
          ...(req.sessionId ? { runtimeSessionId: req.sessionId } : {}),
          qualifier: req.qualifier || 'DEFAULT',
          payload: JSON.stringify(agentCoreRequest),
        };

        const command = new InvokeAgentRuntimeCommand(commandInput);
        const response = await client.send(command);

        // Handle streaming response
        const responseWithStream = response as unknown as {
          response?: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
          contentType?: string;
        };

        let buffer = '';

        if (responseWithStream.response) {
          const stream = responseWithStream.response;

          if (Symbol.asyncIterator in stream) {
            // Handle as async iterable
            for await (const chunk of stream as AsyncIterable<Uint8Array>) {
              if (isFirstChunk) {
                popMessage(); // Remove loading message
                pushMessage('assistant', '');
                isFirstChunk = false;
              }

              const chunkText = new TextDecoder('utf-8').decode(chunk);
              buffer += chunkText;

              // Process complete lines
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.trim()) {
                  let processedText = line;

                  // Handle SSE format: "data: <content>"
                  if (line.startsWith('data: ')) {
                    processedText = line.substring(6);
                  }

                  if (processedText.trim()) {
                    processChunk(
                      processedText,
                      req.model,
                      processor,
                      collectLlmCall
                    );
                  }
                }
              }
            }

            // Process any remaining buffer content
            if (buffer.trim()) {
              let processedText = buffer;
              if (buffer.startsWith('data: ')) {
                processedText = buffer.substring(6);
              }
              if (processedText.trim()) {
                processChunk(
                  processedText,
                  req.model,
                  processor,
                  collectLlmCall
                );
              }
            }
          } else {
            // Fallback: treat as single response
            if (isFirstChunk) {
              popMessage();
              pushMessage('assistant', '');
              isFirstChunk = false;
            }
            processChunk(
              JSON.stringify(response, null, 2),
              req.model,
              processor,
              collectLlmCall
            );
          }
        } else {
          // Fallback: if no response stream, stringify the entire response
          if (isFirstChunk) {
            popMessage();
            pushMessage('assistant', '');
            isFirstChunk = false;
          }
          processChunk(
            JSON.stringify(response, null, 2),
            req.model,
            processor,
            collectLlmCall
          );
        }

        // Observability (PR1): verify llm_call events were collected from the
        // stream. Persistence via GenU API is added in PR2 (cross-repo observability contract §4 PR2).
        console.log(
          `[observability] collected ${llmCalls.length} llm_call event(s) for agent_run_id=${req.agentRunId ?? '(none)'}`,
          llmCalls
        );

        // Save chat history
        const chatId = await createChatIfNotExist();
        await setPredictedTitle();
        const toBeRecordedMessages = attachAgentObservabilityToMessages(
          addMessageIdsToUnrecordedMessages(),
          req.agentRunId,
          req.agentId
        );
        const { messages } = await createMessages(chatId, {
          messages: toBeRecordedMessages,
        });
        replaceMessages(messages);

        await saveAgentObservabilityCompletionBestEffort({
          apis: { appendAgentLlmCalls, completeAgentRun },
          agentRunId: req.agentRunId,
          agentId: req.agentId,
          sessionId: req.sessionId,
          chatId,
          startedAt,
          endedAt: new Date().toISOString(),
          status: 'succeeded',
          errorType: null,
          llmCalls,
          messages: toBeRecordedMessages,
        });
      } catch (error) {
        console.error('Error invoking AgentCore Runtime:', error);
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred';
        // processChunk(`Error: ${errorMessage}`, req.model, processor, collectLlmCall);
        addChunkToAssistantMessage(
          errorMessage,
          undefined,
          req.model,
          undefined
        );
        await saveAgentObservabilityCompletionBestEffort({
          apis: { appendAgentLlmCalls, completeAgentRun },
          agentRunId: req.agentRunId,
          agentId: req.agentId,
          sessionId: req.sessionId,
          startedAt,
          endedAt: new Date().toISOString(),
          status: 'failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
      } finally {
        setLoading(false);
      }
    },
    [
      setLoading,
      streamProcessor,
      pushMessage,
      convertMessagesToStrandsFormat,
      createChatIfNotExist,
      setPredictedTitle,
      addMessageIdsToUnrecordedMessages,
      createMessages,
      startAgentRun,
      completeAgentRun,
      appendAgentLlmCalls,
      replaceMessages,
      popMessage,
      processChunk,
      addChunkToAssistantMessage,
    ]
  );

  return {
    loading,
    postMessage,
    convertMessagesToStrandsFormat,
  };
};

export default useAgentCoreApi;
