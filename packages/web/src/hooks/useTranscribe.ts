import { create } from 'zustand';
import { MediaFormat } from '@aws-sdk/client-transcribe';
import { toast } from 'sonner';
import i18next from 'i18next';
import useTranscribeApi from './useTranscribeApi';
import { withRetry } from '../utils/retry';

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

const useTranscribeState = create<{
  loading: boolean;
  file: File | null;
  setFile: (file: File) => void;
  transcribe: (
    speakerLabel?: boolean,
    maxSpakers?: number,
    languageCode?: string,
    // When set (new-UI batch flow), links the Transcribe job to a meeting so the
    // B3 completion detector can advance the meeting status. See cluster memo §6.
    meetingId?: string
  ) => Promise<void>;
  jobName: string | null;
  status: string;
  setStatus: (status: string) => void;
  clear: () => void;
}>((set, get) => {
  const api = useTranscribeApi();

  const setFile = (file: File) => {
    set(() => ({
      file: file,
    }));
  };

  const setStatus = (status: string) => {
    if (status === 'FAILED') {
      set(() => ({
        status: status,
        loading: false,
      }));
      toast.error(
        i18next.t('meetingMinutes.error.file_transcription_job_failed')
      );
      return;
    }
    set(() => ({
      status: status,
      loading: status === 'COMPLETED' ? false : true,
    }));
  };

  const clear = () => {
    set(() => ({
      status: '',
      jobName: null,
      file: null,
      loading: false,
    }));
  };

  const transcribe = async (
    speakerLabel = false,
    maxSpeakers = 1,
    languageCode?: string,
    meetingId?: string
  ) => {
    const file = get().file;
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error(i18next.t('meetingMinutes.error.file_too_large'));
      return;
    }

    set(() => ({
      loading: true,
    }));

    try {
      const mediaFormat = file.name.split('.').pop() as MediaFormat;

      // Get the signed URL
      const signedUrlRes = await api.getSignedUrl({
        mediaFormat: mediaFormat,
      });
      const signedUrl = signedUrlRes.data;
      const audioUrl = signedUrl.split(/[?#]/)[0]; // Exclude the query parameters from the signed URL

      // Upload the audio with retry
      await withRetry(
        () => api.uploadAudio(signedUrl, { file: file }),
        3,
        1000
      );

      // Start the transcription
      const startTranscriptionRes = await api.startTranscription({
        audioUrl: audioUrl,
        speakerLabel: speakerLabel,
        maxSpeakers: maxSpeakers,
        languageCode: languageCode,
        meetingId: meetingId,
      });

      set(() => ({
        jobName: startTranscriptionRes.jobName,
      }));
    } catch (error) {
      console.error('File transcription error:', error);
      set(() => ({
        loading: false,
      }));
      toast.error(i18next.t('meetingMinutes.error.file_transcription_failed'));
    }
  };

  return {
    file: null,
    loading: false,
    jobName: null,
    status: '',
    clear,
    setFile,
    transcribe,
    setStatus,
  };
});

const useTranscribe = () => {
  const {
    file,
    loading,
    jobName,
    status,
    transcribe,
    setFile,
    setStatus,
    clear,
  } = useTranscribeState();
  const { data: transcriptData } = useTranscribeApi().getTranscription(
    jobName,
    status,
    setStatus
  );
  return {
    loading,
    transcriptData,
    file,
    setFile,
    transcribe,
    clear,
    jobName,
  };
};
export default useTranscribe;
