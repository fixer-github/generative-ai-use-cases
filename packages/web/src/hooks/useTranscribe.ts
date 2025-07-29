import { create } from 'zustand';
import { MediaFormat } from '@aws-sdk/client-transcribe';
import useTranscribeApi from './useTranscribeApi';

const useTranscribeState = create<{
  loading: boolean;
  file: File | null;
  setFile: (file: File) => void;
  transcribe: (
    api: ReturnType<typeof useTranscribeApi>,
    speakerLabel?: boolean,
    maxSpakers?: number,
    languageCode?: string
  ) => Promise<void>;
  jobName: string | null;
  status: string;
  setStatus: (status: string) => void;
  clear: () => void;
}>((set, get) => {
  const setFile = (file: File) => {
    set(() => ({
      file: file,
    }));
  };

  const setStatus = (status: string) => {
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
    }));
  };

  const transcribe = async (
    api: ReturnType<typeof useTranscribeApi>,
    speakerLabel = false,
    maxSpeakers = 1,
    languageCode?: string
  ) => {
    set(() => ({
      loading: true,
    }));

    const mediaFormat = get().file?.name.split('.').pop() as MediaFormat;

    // Get the signed URL
    const signedUrlRes = await api.getSignedUrl({
      mediaFormat: mediaFormat,
    });
    const signedUrl = signedUrlRes.data;
    const audioUrl = signedUrl.split(/[?#]/)[0]; // Exclude the query parameters from the signed URL

    // Upload the audio
    await api.uploadAudio(signedUrl, { file: get().file! });

    // Start the transcription
    const startTranscriptionRes = await api.startTranscription({
      audioUrl: audioUrl,
      speakerLabel: speakerLabel,
      maxSpeakers: maxSpeakers,
      languageCode: languageCode,
    });

    set(() => ({
      jobName: startTranscriptionRes.jobName,
    }));
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
  const api = useTranscribeApi();
  const { data: transcriptData } = api.getTranscription(
    jobName,
    status,
    setStatus
  );
  return {
    loading,
    transcriptData,
    file,
    setFile,
    transcribe: (
      speakerLabel?: boolean,
      maxSpeakers?: number,
      languageCode?: string
    ) => transcribe(api, speakerLabel, maxSpeakers, languageCode),
    clear,
  };
};
export default useTranscribe;
