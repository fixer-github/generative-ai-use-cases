import {
  Item,
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
  LanguageCode,
} from '@aws-sdk/client-transcribe-streaming';
import MicrophoneStream from 'microphone-stream';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import update from 'immutability-helper';
import { Buffer } from 'buffer';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';
import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import { fetchAuthSession } from 'aws-amplify/auth';
import { Transcript } from 'generative-ai-use-cases';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { withRetry } from '../utils/retry';

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

// Recorded audio captured in parallel with the live transcription, so the
// workbench can play it back while editing (B7). The same MediaStream feeds
// both Transcribe and the MediaRecorder; pause/resume drive both so the saved
// audio timeline stays aligned with the transcript timestamps.
export type RecordedAudio = { blob: Blob; mimeType: string; ext: string };

const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

const pickAudioMime = (): string => {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of AUDIO_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
};

const extForMime = (mime: string): string => {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
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

const useMicrophone = () => {
  const { t } = useTranslation();
  const [micStream, setMicStream] = useState<MicrophoneStream | undefined>();
  const [recording, setRecording] = useState(false);
  // Pause/resume is implemented by toggling the captured MediaStream's audio
  // tracks. A disabled track keeps yielding silent frames, so the Transcribe
  // streaming connection stays alive (no idle timeout) while no speech is sent.
  // Additive: existing callers that never use pause/resume are unaffected.
  const mediaStreamRef = useRef<MediaStream | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  // Parallel recorder (B7). Holds the chunks until collectAudio() assembles the
  // blob; stopTranscription discards them (e.g. when the user navigates back).
  const recorderRef = useRef<MediaRecorder | undefined>(undefined);
  const chunksRef = useRef<Blob[]>([]);
  const audioMimeRef = useRef<string>('');
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

  const transcriptMic = useMemo(() => {
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

  // Stop and discard the parallel recorder (no blob is kept). collectAudio()
  // is the path that preserves the recording.
  const discardRecorder = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.ondataavailable = null;
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        // already stopping
      }
    }
    recorderRef.current = undefined;
    chunksRef.current = [];
  }, []);

  const stopTranscription = useCallback(() => {
    if (micStream) {
      discardRecorder();
      micStream.stop();
      setRecording(false);
      setMicStream(undefined);
      mediaStreamRef.current = undefined;
      setPaused(false);
    }
  }, [micStream, discardRecorder]);

  // Stop the recorder and resolve with the assembled audio blob (B7). Call this
  // BEFORE stopTranscription so the recording is captured before teardown.
  const collectAudio = useCallback((): Promise<RecordedAudio | null> => {
    return new Promise((resolve) => {
      const rec = recorderRef.current;
      if (!rec || rec.state === 'inactive') {
        resolve(null);
        return;
      }
      rec.onstop = () => {
        const chunks = chunksRef.current;
        chunksRef.current = [];
        recorderRef.current = undefined;
        if (chunks.length === 0) {
          resolve(null);
          return;
        }
        const mimeType = audioMimeRef.current || rec.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        resolve(
          blob.size > 0 ? { blob, mimeType, ext: extForMime(mimeType) } : null
        );
      };
      try {
        rec.stop();
      } catch {
        resolve(null);
      }
    });
  }, []);

  // Mute the mic without tearing down the stream (Transcribe receives silence).
  // The recorder is paused too so the saved audio skips the muted span and its
  // timeline stays aligned with the transcript timestamps.
  const pauseTranscription = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') rec.pause();
    setPaused(true);
  }, []);

  const resumeTranscription = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    const rec = recorderRef.current;
    if (rec && rec.state === 'paused') rec.resume();
    setPaused(false);
  }, []);

  const startStream = async (
    mic: MicrophoneStream,
    languageCode?: LanguageCode,
    speakerLabel: boolean = false,
    languageOptions?: string[],
    enableMultiLanguage: boolean = false
  ) => {
    if (!transcribeClient) return;

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

    const createCommand = () => {
      const audioStream = async function* () {
        for await (const chunk of mic as unknown as Buffer[]) {
          yield {
            AudioEvent: {
              AudioChunk: pcmEncodeChunk(chunk),
            },
          };
        }
      };
      return new StartStreamTranscriptionCommand({
        ...commandParams,
        MediaEncoding: 'pcm',
        MediaSampleRateHertz: 48000,
        AudioStream: audioStream(),
        ShowSpeakerLabel: speakerLabel,
      });
    };

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
                      resultId:
                        result.ResultId ?? `mic-${Date.now()}-${Math.random()}`,
                      startTime: result.StartTime ?? 0,
                      endTime: result.EndTime ?? 0,
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
                        resultId:
                          result.ResultId ??
                          `mic-${Date.now()}-${Math.random()}`,
                        startTime: result.StartTime ?? 0,
                        endTime: result.EndTime ?? 0,
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
      console.error('Microphone transcription error:', error);
      toast.error(t('meetingMinutes.error.mic_transcription_failed'));
    } finally {
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
    const mic = new MicrophoneStream();
    try {
      setMicStream(mic);
      const stream = await window.navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true,
      });
      // Keep a reference so pause/resume can toggle the tracks.
      mediaStreamRef.current = stream;
      setPaused(false);
      mic.setStream(stream);

      // Record the same stream in parallel for playback (B7). The MediaStream
      // can feed both Transcribe and the recorder. Failure here must not break
      // transcription, so the audio is simply not saved if recording fails.
      try {
        if (typeof MediaRecorder !== 'undefined') {
          const mime = pickAudioMime();
          const rec = mime
            ? new MediaRecorder(stream, { mimeType: mime })
            : new MediaRecorder(stream);
          audioMimeRef.current = rec.mimeType || mime;
          chunksRef.current = [];
          rec.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
          };
          recorderRef.current = rec;
          rec.start(1000); // 1s timeslice so chunks flush periodically
        }
      } catch (e) {
        console.log('MediaRecorder init failed (audio will not be saved):', e);
        recorderRef.current = undefined;
      }

      setRecording(true);
      await startStream(
        mic,
        languageCode,
        speakerLabel,
        languageOptions,
        enableMultiLanguage
      );
    } catch (e) {
      console.log('Microphone capture error:', e);
      if (e instanceof Error) {
        if (e.name === 'NotAllowedError') {
          toast.error(t('meetingMinutes.error.mic_permission_denied'));
        } else if (
          e.name === 'NotFoundError' ||
          e.name === 'OverconstrainedError'
        ) {
          toast.error(t('meetingMinutes.error.mic_not_available'));
        } else {
          toast.error(t('meetingMinutes.error.mic_transcription_failed'));
        }
      }
    } finally {
      discardRecorder();
      mic.stop();
      setRecording(false);
      setMicStream(undefined);
      mediaStreamRef.current = undefined;
      setPaused(false);
    }
  };

  const clearTranscripts = () => {
    setRawTranscripts([]);
  };

  return {
    startTranscription,
    stopTranscription,
    collectAudio,
    pauseTranscription,
    resumeTranscription,
    paused,
    // True once the Transcribe streaming client is initialized and a session
    // can be started (callers that auto-start on mount should wait for this).
    ready: !!transcribeClient,
    recording,
    transcriptMic,
    clearTranscripts,
    rawTranscripts,
  };
};

export default useMicrophone;
