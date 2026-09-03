import {
  Item,
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
  LanguageCode,
} from '@aws-sdk/client-transcribe-streaming';
import MicrophoneStream from 'microphone-stream';
import { useState, useEffect, useMemo, useCallback } from 'react';
import update from 'immutability-helper';
import { Buffer } from 'buffer';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';
import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import { fetchAuthSession } from 'aws-amplify/auth';
import { Transcript } from 'generative-ai-use-cases';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { withRetry } from '../utils/retry';
import useLicenseApi from './useLicenseApi';

// Sample rate of the PCM audio sent to Transcribe (MediaSampleRateHertz).
// Also used to convert the number of sent samples into seconds for
// license metering.
const TRANSCRIBE_SAMPLE_RATE = 48000;

const pcmEncodeChunk = (chunk: Buffer) => {
  const input = MicrophoneStream.toRaw(chunk);
  let offset = 0;
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return Buffer.from(buffer);
};

const region = import.meta.env.VITE_APP_REGION;
const cognitoIdentityPoolProxyEndpoint = import.meta.env
  .VITE_APP_COGNITO_IDENTITY_POOL_PROXY_ENDPOINT;
const cognito = new CognitoIdentityClient({
  region,
  ...(cognitoIdentityPoolProxyEndpoint
    ? { endpoint: cognitoIdentityPoolProxyEndpoint }
    : {}),
});
const userPoolId = import.meta.env.VITE_APP_USER_POOL_ID;
const idPoolId = import.meta.env.VITE_APP_IDENTITY_POOL_ID;
const providerName = `cognito-idp.${region}.amazonaws.com/${userPoolId}`;

const useScreenAudio = () => {
  const { t } = useTranslation();
  const { startTranscribeSession, reportTranscribeSession } = useLicenseApi();
  const [screenStream, setScreenStream] = useState<
    MicrophoneStream | undefined
  >();
  const [recording, setRecording] = useState(false);
  const [rawTranscripts, setRawTranscripts] = useState<
    {
      resultId: string;
      startTime: number;
      endTime: number;
      isPartial: boolean;
      transcripts: Transcript[];
      languageCode?: string;
    }[]
  >([]);
  const [language, setLanguage] = useState<string>('ja-JP');
  const [transcribeClient, setTranscribeClient] =
    useState<TranscribeStreamingClient>();
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [preparedDisplayStream, setPreparedDisplayStream] =
    useState<MediaStream | null>(null);

  // Check browser support
  useEffect(() => {
    const supported =
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getDisplayMedia === 'function';
    setIsSupported(supported);
  }, []);

  const transcriptScreen = useMemo(() => {
    const transcripts: Transcript[] = rawTranscripts.flatMap(
      (t) => t.transcripts
    );
    // If the speaker is continuous, merge
    const mergedTranscripts = transcripts.reduce((prev, item) => {
      if (
        prev.length === 0 ||
        item.speakerLabel !== prev[prev.length - 1].speakerLabel
      ) {
        prev.push({
          speakerLabel: item.speakerLabel,
          transcript: item.transcript,
        });
      } else {
        prev[prev.length - 1].transcript += ' ' + item.transcript;
      }
      return prev;
    }, [] as Transcript[]);
    // If Japanese, remove spaces
    if (language === 'ja-JP') {
      return mergedTranscripts.map((item) => ({
        ...item,
        transcript: item.transcript.replace(/ /g, ''),
      }));
    }
    return mergedTranscripts;
  }, [rawTranscripts, language]);

  const initTranscribeClient = useCallback(async () => {
    try {
      const session = await withRetry(() => fetchAuthSession());
      const token = session.tokens?.idToken?.toString();
      if (!token) {
        return;
      }

      const transcribe = new TranscribeStreamingClient({
        region,
        credentials: fromCognitoIdentityPool({
          client: cognito,
          identityPoolId: idPoolId,
          logins: {
            [providerName]: token,
          },
        }),
      });
      setTranscribeClient(transcribe);
    } catch {
      console.error('Failed to initialize TranscribeClient');
      toast.error(t('meetingMinutes.error.auth_session_failed'));
    }
  }, [t]);

  useEffect(() => {
    if (transcribeClient) return;
    initTranscribeClient();
  }, [transcribeClient, initTranscribeClient]);

  const stopTranscription = useCallback(() => {
    if (screenStream) {
      screenStream.stop();
      setRecording(false);
      setScreenStream(undefined);
    }

    // Clean up prepared stream if exists
    if (preparedDisplayStream) {
      preparedDisplayStream.getTracks().forEach((track) => track.stop());
      setPreparedDisplayStream(null);
    }
  }, [screenStream, preparedDisplayStream]);

  const startStream = async (
    stream: MicrophoneStream,
    languageCode?: LanguageCode,
    speakerLabel: boolean = false,
    languageOptions?: string[],
    enableMultiLanguage: boolean = false
  ) => {
    if (!transcribeClient) return;

    // --- License metering: start a transcription session ---
    // If the license is unassigned/exhausted (or the check fails),
    // do not start streaming at all.
    const sessionId = crypto.randomUUID();
    let reportIntervalSeconds = 15;
    try {
      const session = await startTranscribeSession({
        sessionId,
        mode: 'screen',
      });
      if (!session.allowed) {
        toast.error(t('license.transcribe.blocked_start'));
        return;
      }
      if (session.reportIntervalSeconds > 0) {
        reportIntervalSeconds = session.reportIntervalSeconds;
      }
    } catch (error) {
      console.error('Failed to start license transcribe session:', error);
      toast.error(t('license.transcribe.blocked_start'));
      return;
    }

    // Update Language
    if (languageCode) {
      setLanguage(languageCode);
    }

    // Best Practice: https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html
    let commandParams;

    if (enableMultiLanguage) {
      // Multi-language identification mode (bidirectional translation)
      commandParams = {
        LanguageCode: undefined,
        IdentifyLanguage: false,
        IdentifyMultipleLanguages: true,
        LanguageOptions: languageOptions
          ? languageOptions.join(',')
          : 'en-US,ja-JP',
      };
    } else if (languageCode) {
      // Specific language mode
      commandParams = {
        LanguageCode: languageCode,
        IdentifyLanguage: false,
        IdentifyMultipleLanguages: false,
        LanguageOptions: undefined,
      };
    } else {
      // Auto language identification mode
      commandParams = {
        LanguageCode: undefined,
        IdentifyLanguage: true,
        IdentifyMultipleLanguages: false,
        LanguageOptions: languageOptions
          ? languageOptions.join(',')
          : 'en-US,ja-JP',
      };
    }

    // Cumulative number of PCM samples actually sent to Transcribe.
    // Wall-clock time is NOT used: paused/unsent audio must not be counted.
    let sentSamples = 0;
    const cumulativeSeconds = () =>
      Math.round((sentSamples / TRANSCRIBE_SAMPLE_RATE) * 10) / 10;

    const createCommand = () => {
      const audioStream = async function* () {
        for await (const chunk of stream as unknown as Buffer[]) {
          const audioChunk = pcmEncodeChunk(chunk);
          // 2 bytes per 16-bit PCM sample
          sentSamples += audioChunk.length / 2;
          yield {
            AudioEvent: {
              AudioChunk: audioChunk,
            },
          };
        }
      };
      return new StartStreamTranscriptionCommand({
        ...commandParams,
        MediaEncoding: 'pcm',
        MediaSampleRateHertz: TRANSCRIBE_SAMPLE_RATE,
        AudioStream: audioStream(),
        ShowSpeakerLabel: speakerLabel,
      });
    };

    // --- License metering: periodic usage reports ---
    // The server may respond with stop === true when the allocation is
    // used up; in that case the streaming session is shut down.
    let stoppedByLicense = false;
    const reportTimer = setInterval(() => {
      reportTranscribeSession({
        sessionId,
        cumulativeSeconds: cumulativeSeconds(),
      })
        .then((res) => {
          if (res.stop && !stoppedByLicense) {
            stoppedByLicense = true;
            toast.error(t('license.transcribe.stopped'));
            // Stopping the source stream ends the audio generator and
            // winds down the Transcribe streaming session.
            stream.stop();
          }
        })
        .catch((error) => {
          // Missing interim reports are absorbed server-side
          console.error('Failed to report transcribe usage:', error);
        });
    }, reportIntervalSeconds * 1000);

    try {
      const response = await withRetry(
        () => transcribeClient.send(createCommand()),
        3,
        1000
      );

      if (response.TranscriptResultStream) {
        for await (const event of response.TranscriptResultStream) {
          if (
            event.TranscriptEvent?.Transcript?.Results &&
            event.TranscriptEvent.Transcript?.Results.length > 0
          ) {
            // Get multiple possible results, but this code only processes a single result
            const result = event.TranscriptEvent.Transcript?.Results[0];

            // Update Language
            if (result.LanguageCode) {
              setLanguage(result.LanguageCode);
            }

            // Process Multiple Speaker
            const transcriptItems =
              result.Alternatives?.flatMap(
                (alternative) => alternative.Items ?? []
              ) ?? [];
            // Merge consecutive transcript with same Speaker
            const mergedTranscripts = transcriptItems.reduce((acc, curr) => {
              if (acc.length > 0 && curr.Type === 'punctuation') {
                acc[acc.length - 1].Content += curr.Content || '';
              } else if (
                acc.length > 0 &&
                acc[acc.length - 1].Speaker === curr.Speaker
              ) {
                acc[acc.length - 1].Content += ' ' + (curr.Content || '');
              } else {
                acc.push(curr);
              }
              return acc;
            }, [] as Item[]);
            const transcripts: Transcript[] = mergedTranscripts?.map(
              (item) => ({
                speakerLabel: item.Speaker ? 'spk_' + item.Speaker : undefined,
                transcript: item.Content || '',
              })
            );

            setRawTranscripts((prev) => {
              if (prev.length === 0 || !prev[prev.length - 1].isPartial) {
                // segment is complete
                const tmp = update(prev, {
                  $push: [
                    {
                      resultId: result.ResultId || '',
                      startTime: result.StartTime || 0,
                      endTime: result.EndTime || 0,
                      isPartial: result.IsPartial ?? false,
                      transcripts,
                      languageCode: result.LanguageCode,
                    },
                  ],
                });
                return tmp;
              } else {
                // segment is NOT complete(overrides the previous segment's transcript)
                const tmp = update(prev, {
                  $splice: [
                    [
                      prev.length - 1,
                      1,
                      {
                        resultId: result.ResultId || '',
                        startTime: result.StartTime || 0,
                        endTime: result.EndTime || 0,
                        isPartial: result.IsPartial ?? false,
                        transcripts,
                        languageCode: result.LanguageCode,
                      },
                    ],
                  ],
                });
                return tmp;
              }
            });
          }
        }
      }
    } catch (error) {
      console.error('Screen audio transcription error:', error);
      toast.error(t('meetingMinutes.error.screen_transcription_failed'));
    } finally {
      clearInterval(reportTimer);
      // --- License metering: final report (fire-and-forget so the UI
      // stops normally even if the report fails) ---
      reportTranscribeSession({
        sessionId,
        cumulativeSeconds: cumulativeSeconds(),
        final: true,
      }).catch((error) => {
        console.error('Failed to send final transcribe report:', error);
      });
      stopTranscription();
      transcribeClient.destroy();
      setTranscribeClient(undefined);
    }
  };

  const startTranscription = async (
    languageCode?: LanguageCode,
    speakerLabel?: boolean,
    languageOptions?: string[],
    enableMultiLanguage?: boolean
  ) => {
    if (!isSupported) {
      toast.error(t('meetingMinutes.error.screen_audio_not_supported'));
      return;
    }

    const stream = new MicrophoneStream();
    try {
      setScreenStream(stream);

      // Request screen audio capture
      // Note: Most browsers require video to be true when capturing audio
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
        },
        audio: true,
      });

      // Extract only the audio track
      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track available in screen capture');
      }

      // Create a new MediaStream with only audio
      const audioOnlyStream = new MediaStream(audioTracks);

      // Stop the video track to save resources
      const videoTracks = displayStream.getVideoTracks();
      videoTracks.forEach((track) => track.stop());

      stream.setStream(audioOnlyStream);
      setRecording(true);
      await startStream(
        stream,
        languageCode,
        speakerLabel,
        languageOptions,
        enableMultiLanguage
      );
    } catch (e) {
      console.log('Screen audio capture error:', e);
      if (e instanceof Error) {
        if (e.name === 'NotAllowedError') {
          toast.error(t('meetingMinutes.error.screen_audio_denied'));
        } else if (e.name === 'NotSupportedError') {
          toast.error(t('meetingMinutes.error.screen_audio_not_supported'));
        } else if (e.message.includes('No audio track')) {
          toast.error(t('meetingMinutes.error.screen_audio_no_audio_track'));
        } else {
          toast.error(t('meetingMinutes.error.screen_audio_failed'));
        }
      }
    } finally {
      stream.stop();
      setRecording(false);
      setScreenStream(undefined);
    }
  };

  /**
   * Prepares screen capture by requesting user permission and screen selection.
   * This function only handles the preparation phase (getDisplayMedia) without starting
   * the actual recording. This allows synchronization with microphone recording by
   * completing user interactions upfront, then starting both recordings simultaneously.
   *
   * @returns Promise<MediaStream> The prepared display stream with audio tracks
   * @throws Error if screen capture is not supported or user denies permission
   */
  const prepareScreenCapture = async (): Promise<MediaStream> => {
    if (!isSupported) {
      throw new Error('Screen audio capture is not supported in this browser');
    }

    try {
      // Request screen audio capture
      // Note: Most browsers require video to be true when capturing audio
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
        },
        audio: true,
      });

      // Check if audio track is available
      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track available in screen capture');
      }

      setPreparedDisplayStream(displayStream);
      return displayStream;
    } catch (e) {
      console.log('Screen audio capture preparation error:', e);
      if (e instanceof Error) {
        if (e.name === 'NotAllowedError') {
          toast.error(t('meetingMinutes.error.screen_audio_denied'));
        } else if (e.name === 'NotSupportedError') {
          toast.error(t('meetingMinutes.error.screen_audio_not_supported'));
        } else if (e.message.includes('No audio track')) {
          toast.error(t('meetingMinutes.error.screen_audio_no_audio_track'));
        } else {
          toast.error(t('meetingMinutes.error.screen_audio_failed'));
        }
      }
      throw e;
    }
  };

  /**
   * Starts screen audio transcription using a pre-prepared display stream.
   * This function is designed to work with prepareScreenCapture() for synchronized
   * recording. It extracts audio tracks from the provided stream and begins
   * transcription without additional user interaction delays.
   *
   * @param displayStream The MediaStream obtained from prepareScreenCapture()
   * @param languageCode Optional language code for transcription
   * @param speakerLabel Whether to enable speaker recognition
   */
  const startTranscriptionWithStream = async (
    displayStream: MediaStream,
    languageCode?: LanguageCode,
    speakerLabel?: boolean,
    languageOptions?: string[],
    enableMultiLanguage?: boolean
  ) => {
    const stream = new MicrophoneStream();
    try {
      setScreenStream(stream);

      // Extract only the audio track
      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track available in screen capture');
      }

      // Create a new MediaStream with only audio
      const audioOnlyStream = new MediaStream(audioTracks);

      // Stop the video track to save resources
      const videoTracks = displayStream.getVideoTracks();
      videoTracks.forEach((track) => track.stop());

      stream.setStream(audioOnlyStream);
      setRecording(true);
      await startStream(
        stream,
        languageCode,
        speakerLabel,
        languageOptions,
        enableMultiLanguage
      );
    } catch (e) {
      console.log('Screen audio transcription error:', e);
      if (e instanceof Error) {
        if (e.message.includes('No audio track')) {
          toast.error(t('meetingMinutes.error.screen_audio_no_audio_track'));
        } else {
          toast.error(t('meetingMinutes.error.screen_audio_failed'));
        }
      }
    } finally {
      stream.stop();
      setRecording(false);
      setScreenStream(undefined);
      // Clean up prepared stream
      if (preparedDisplayStream === displayStream) {
        setPreparedDisplayStream(null);
      }
    }
  };

  const clearTranscripts = () => {
    setRawTranscripts([]);
  };

  return {
    startTranscription,
    prepareScreenCapture,
    startTranscriptionWithStream,
    stopTranscription,
    recording,
    transcriptScreen,
    clearTranscripts,
    isSupported,
    rawTranscripts,
  };
};

export default useScreenAudio;
