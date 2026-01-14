import { useState, useCallback } from 'react';
import useChatApi from './useChatApi';
import { MODELS } from './useModel';
import { getPrompter } from '../prompts';
import { UnrecordedMessage, Model, StreamingChunk } from 'generative-ai-use-cases';

export type MeetingMinutesStyle =
  | 'faq'
  | 'newspaper'
  | 'transcription'
  | 'custom';

// Maximum number of continuation attempts to prevent infinite loops
const MAX_CONTINUATION_ATTEMPTS = 5;

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

        // Helper function to process stream and return stopReason
        const processStream = async (
          stream: AsyncGenerator<string, void, unknown>
        ): Promise<string> => {
          let stopReason = '';

          for await (const chunk of stream) {
            if (chunk) {
              const chunks = chunk.split('\n');

              for (const c of chunks) {
                if (c && c.length > 0) {
                  try {
                    const payload = JSON.parse(c) as StreamingChunk;
                    if (payload.text && payload.text.length > 0) {
                      fullResponse += payload.text;
                      setGeneratedMinutes(fullResponse);
                    }
                    if (payload.stopReason) {
                      stopReason = payload.stopReason;
                    }
                  } catch (error) {
                    // Skip invalid JSON chunks
                    console.debug('Skipping invalid JSON chunk:', c);
                  }
                }
              }
            }
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
                // eslint-disable-next-line i18nhelper/no-jp-string
                '続きを出力してください。前回の出力の続きから始めてください。',
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
