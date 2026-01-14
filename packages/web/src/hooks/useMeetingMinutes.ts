import { useState, useCallback } from 'react';
import useChatApi from './useChatApi';
import { MODELS } from './useModel';
import { getPrompter } from '../prompts';
import {
  UnrecordedMessage,
  Model,
  StreamingChunk,
} from 'generative-ai-use-cases';

export type MeetingMinutesStyle =
  | 'faq'
  | 'newspaper'
  | 'transcription'
  | 'custom';

// Maximum number of continuation attempts to prevent infinite loops
const MAX_CONTINUATION_ATTEMPTS = 5;

// Maximum consecutive parse errors before considering the stream corrupted
const MAX_CONSECUTIVE_PARSE_ERRORS = 10;

export const useMeetingMinutes = (
  minutesStyle: MeetingMinutesStyle,
  customPrompt: string,
  autoGenerateSessionTimestamp: number | null,
  setGeneratedMinutes: (minutes: string) => void,
  setLastProcessedTranscript: (transcript: string) => void,
  setLastGeneratedTime: (time: Date | null) => void
) => {
  const { predictStream } = useChatApi();
  const { modelIds: availableModels, textModels } = MODELS;

  // Only keep local state for temporary values
  const [loading, setLoading] = useState(false);

  const generateMinutes = useCallback(
    async (
      transcript: string,
      modelId: string,
      onGenerate?: (
        status: 'generating' | 'continuing' | 'success' | 'error',
        data?: {
          message?: string;
          minutes?: string;
          continuationAttempt?: number;
          maxContinuationAttempts?: number;
        }
      ) => void
    ) => {
      if (!transcript || transcript.trim() === '') return;

      const model = textModels.find((m) => m.modelId === modelId);
      if (!model) {
        onGenerate?.('error', { message: 'Model not found' });
        return;
      }

      setLoading(true);
      onGenerate?.('generating');

      try {
        const prompter = getPrompter(modelId);

        const promptContent =
          minutesStyle === 'custom' && customPrompt
            ? customPrompt
            : prompter.meetingMinutesPrompt({
                style: minutesStyle,
                customPrompt,
              });

        let fullResponse = '';
        let lastStopReason = '';
        let continuationCount = 0;
        setGeneratedMinutes('');

        // Helper function to process stream chunks, accumulate response text,
        // update UI via setGeneratedMinutes, and return the final stopReason
        const processStream = async (
          stream: AsyncGenerator<string, void, unknown>
        ): Promise<string> => {
          let stopReason = '';
          let consecutiveParseErrors = 0;
          let successfulParses = 0;

          for await (const chunk of stream) {
            if (chunk) {
              const chunks = chunk.split('\n');

              for (const c of chunks) {
                if (c && c.length > 0) {
                  try {
                    const payload = JSON.parse(c) as StreamingChunk;
                    consecutiveParseErrors = 0; // Reset on successful parse
                    successfulParses++;

                    if (payload.text && payload.text.length > 0) {
                      fullResponse += payload.text;
                      setGeneratedMinutes(fullResponse);
                    }
                    if (payload.stopReason) {
                      stopReason = payload.stopReason;

                      // Handle explicit error responses from backend
                      if (payload.stopReason === 'error') {
                        throw new Error(
                          payload.text ||
                            'API returned an error during streaming'
                        );
                      }
                    }
                  } catch (error) {
                    // Re-throw if it's our explicit error
                    if (
                      error instanceof Error &&
                      error.message.includes('API returned an error')
                    ) {
                      throw error;
                    }

                    // Track consecutive parse errors to detect stream corruption
                    consecutiveParseErrors++;
                    console.warn('Failed to parse JSON chunk:', c);

                    if (
                      consecutiveParseErrors >= MAX_CONSECUTIVE_PARSE_ERRORS
                    ) {
                      throw new Error(
                        'Stream processing failed: too many consecutive parse errors'
                      );
                    }
                  }
                }
              }
            }
          }

          // Warn if we received no successful parses (possible complete stream failure)
          if (successfulParses === 0 && consecutiveParseErrors > 0) {
            console.error(
              'No chunks were successfully parsed from stream, possible stream corruption'
            );
          }

          return stopReason;
        };

        // Initial generation
        const initialMessages: UnrecordedMessage[] = [
          {
            role: 'system',
            content: promptContent,
          },
          {
            role: 'user',
            content: transcript,
          },
        ];

        const initialStream = predictStream({
          model: model as Model,
          messages: initialMessages,
          id: `meeting-minutes-${autoGenerateSessionTimestamp || Date.now()}`,
        });

        lastStopReason = await processStream(initialStream);

        // Continuation loop for max_tokens
        while (
          lastStopReason === 'max_tokens' &&
          continuationCount < MAX_CONTINUATION_ATTEMPTS
        ) {
          continuationCount++;
          onGenerate?.('continuing', {
            continuationAttempt: continuationCount,
            maxContinuationAttempts: MAX_CONTINUATION_ATTEMPTS,
          });

          // Build continuation messages with previous response
          const continueMessages: UnrecordedMessage[] = [
            {
              role: 'system',
              content: promptContent,
            },
            {
              role: 'user',
              content: transcript,
            },
            {
              role: 'assistant',
              content: fullResponse,
            },
            {
              role: 'user',
              content:
                'Please continue from where you left off. Start from the end of the previous output.',
            },
          ];

          const continueStream = predictStream({
            model: model as Model,
            messages: continueMessages,
            id: `meeting-minutes-continue-${continuationCount}-${autoGenerateSessionTimestamp || Date.now()}`,
          });

          lastStopReason = await processStream(continueStream);
        }

        setLastProcessedTranscript(transcript);
        setLastGeneratedTime(new Date());
        onGenerate?.('success', { minutes: fullResponse });
      } catch (error) {
        console.error('Meeting minutes generation failed:', error);
        onGenerate?.('error', {
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        setLoading(false);
      }
    },
    [
      minutesStyle,
      customPrompt,
      predictStream,
      textModels,
      autoGenerateSessionTimestamp,
      setGeneratedMinutes,
      setLastGeneratedTime,
      setLastProcessedTranscript,
    ]
  );

  const clearMinutes = useCallback(() => {
    setGeneratedMinutes('');
    setLastProcessedTranscript('');
    setLastGeneratedTime(null);
  }, [setGeneratedMinutes, setLastProcessedTranscript, setLastGeneratedTime]);

  return {
    // State
    loading,

    // Actions
    generateMinutes,
    clearMinutes,

    // Utilities
    availableModels,
  };
};

export default useMeetingMinutes;
