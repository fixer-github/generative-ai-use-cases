import React, {
  useCallback,
  useEffect,
  useState,
  useRef,
  useMemo,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useChat from '@/hooks/useChat';
import useTyping from '@/hooks/useTyping';
import useFileApi from '@/hooks/useFileApi';
import { UploadedFileType } from 'generative-ai-use-cases';
import { extractBaseURL } from '@/hooks/useFiles';
import { create } from 'zustand';
import { getPrompter } from '@/prompts';
import { VideoAnalyzerPageQueryParams } from '@/@types/navigate';
import { MODELS } from '@/hooks/useModel';
import Button from '@/components/ui/Button';
import Markdown from '@/components/utility/Markdown';
import InputChatContent from '@/components/feature/chat/InputChatContent';
import Card from '@/components/ui/Card';
import Select from '@/components/ui/Select';
import queryString from 'query-string';
import { v4 as uuidv4 } from 'uuid';
import PageContainer from '@/components/layout/PageContainer';
import Spinner from '@/components/ui/loading/Spinner';

type StateType = {
  content: string;
  setContent: (c: string) => void;
  analysis: string;
  setAnalysis: (a: string) => void;
  clear: () => void;
};

const useVideoAnalyzerPageState = create<StateType>((set) => {
  const INIT_STATE = {
    content: '',
    analysis: '',
  };
  return {
    ...INIT_STATE,
    setContent: (c: string) => {
      set(() => ({
        content: c,
      }));
    },
    setAnalysis: (a: string) => {
      set(() => ({
        analysis: a,
      }));
    },
    clear: () => {
      set(INIT_STATE);
    },
  };
});

const VideoAnalyzerPage: React.FC = () => {
  const { t } = useTranslation();
  const { content, setContent, analysis, setAnalysis, clear } =
    useVideoAnalyzerPageState();
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [devices, setDevices] = useState<{ value: string; label: string }[]>(
    []
  );
  const [deviceId, setDeviceId] = useState('');
  const [sending, setSending] = useState(false);
  const videoElement = useRef<HTMLVideoElement | null>(null);
  const callbackRef = useRef<() => void>();
  const { getSignedUrl, uploadFile } = useFileApi();
  const { pathname, search } = useLocation();
  const {
    getModelId,
    setModelId,
    loading,
    messages,
    postChat,
    clear: clearChat,
  } = useChat(pathname);
  const { setTypingTextInput, typingTextOutput } = useTyping(loading);
  const { visionModelIds, modelDisplayName } = MODELS;
  const modelId = getModelId();
  const prompter = useMemo(() => {
    return getPrompter(modelId);
  }, [modelId]);

  useEffect(() => {
    const _modelId = !modelId ? visionModelIds[0] : modelId;
    if (search !== '') {
      const params = queryString.parse(search) as VideoAnalyzerPageQueryParams;
      setContent(params.content);
      setModelId(
        visionModelIds.includes(params.modelId ?? '')
          ? params.modelId!
          : _modelId
      );
    } else {
      setModelId(_modelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setContent, modelId, visionModelIds, search]);

  useEffect(() => {
    setTypingTextInput(analysis);
  }, [analysis, setTypingTextInput]);

  useEffect(() => {
    const getDevices = async () => {
      // Request camera access for users who open the page for the first time (dummy request)
      const dummyStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true,
      });

      if (dummyStream) {
        // The recording button is added, so we remove it
        dummyStream.getTracks().forEach((track) => track.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices
          .filter((device) => device.kind === 'videoinput')
          .map((device) => {
            return {
              value: device.deviceId,
              label: device.label.replace(/\s\(.*?\)/g, ''),
            };
          });
        setDevices(videoDevices);
      }
    };

    getDevices();
  }, []);

  useEffect(() => {
    if (deviceId.length === 0 && devices.length > 0) {
      setDeviceId(devices[0].value);
    }
  }, [deviceId, devices]);

  useEffect(() => {
    if (messages.length === 0) return;
    const _lastMessage = messages[messages.length - 1];
    if (_lastMessage.role !== 'assistant') return;
    const _response = messages[messages.length - 1].content;
    setAnalysis(_response.trim());
  }, [messages, setAnalysis]);

  const onClickClear = useCallback(() => {
    clear();
    clearChat();
  }, [clear, clearChat]);

  const sendFrame = useCallback(() => {
    if (!videoElement.current) return;

    setSending(true);

    const canvas = document.createElement('canvas');
    canvas.width = videoElement.current.videoWidth;
    canvas.height = videoElement.current.videoHeight;
    const context = canvas.getContext('2d');
    context!.drawImage(videoElement.current, 0, 0, canvas.width, canvas.height);
    // The value returned by toDataURL() is in the following format (only the ;base64, part)
    // ```
    // data:image/png;base64,<base64...>
    // ```
    const imageBase64 = canvas.toDataURL('image/png').split(';base64,')[1];

    canvas.toBlob(async (blob) => {
      const file = new File([blob!], 'tmp.png', { type: 'image/png' });
      const signedUrl = (await getSignedUrl({ mediaFormat: 'png' })).data;
      await uploadFile(signedUrl, { file });
      const baseUrl = extractBaseURL(signedUrl);
      const fileId = uuidv4();
      const uploadedFiles: UploadedFileType[] = [
        {
          id: fileId,
          file,
          name: file.name,
          type: 'image',
          mimeType: 'image/png',
          s3Url: baseUrl,
          base64EncodedData: imageBase64,
          uploading: false,
          errorMessages: [],
        },
      ];

      postChat(
        prompter.videoAnalyzerPrompt({
          content,
        }),
        false,
        undefined,
        undefined,
        undefined,
        uploadedFiles
      );

      setSending(false);
    });
  }, [prompter, content, postChat, getSignedUrl, uploadFile]);

  const startRecording = useCallback(async () => {
    try {
      if (videoElement.current) {
        setRecording(true);

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: {
              exact: deviceId,
            },
          },
        });
        videoElement.current.srcObject = stream;
        videoElement.current.play();

        setMediaStream(stream);
      }
    } catch (e) {
      console.error(t('videoAnalyzer.errors.cameraAccessFailed'), e);
    }
  }, [setRecording, videoElement, deviceId, t]);

  // Stop video
  const stopRecording = useCallback(() => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
    }
    setRecording(false);
  }, [mediaStream]);

  // Keep the callback function always up to date
  useEffect(() => {
    callbackRef.current = stopRecording;
  }, [stopRecording]);

  // Process when unmounting (when leaving the screen)
  useEffect(() => {
    return () => {
      if (callbackRef.current) {
        callbackRef.current();
        callbackRef.current = undefined;
      }
    };
  }, []);

  return (
    <PageContainer title={t('videoAnalyzer.title')}>
      <Card label={t('videoAnalyzer.label')}>
          <div className="flex flex-col gap-x-4 xl:flex-row">
            <div className="">
              <div className="mb-3 flex w-full flex-col lg:flex-row lg:items-end">
                <Select
                  value={deviceId}
                  options={devices}
                  clearable={false}
                  onChange={setDeviceId}
                  label={t('videoAnalyzer.camera')}
                  fullWidth
                />

                {recording ? (
                  <>
                    <Button
                      onClick={stopRecording}
                      className="mb-3 h-fit w-16 lg:ml-3">
                      {t('videoAnalyzer.stop')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      onClick={startRecording}
                      className="mb-3 h-fit w-16 lg:ml-3">
                      {t('videoAnalyzer.start')}
                    </Button>
                  </>
                )}
              </div>

              <div className="w-48 sm:w-64 lg:w-96">
                <video ref={videoElement} />
              </div>
            </div>

            <div className="mt-3 w-full xl:mt-0">
              <Select
                value={modelId}
                onChange={setModelId}
                options={visionModelIds.map((m) => {
                  return { value: m, label: modelDisplayName(m) };
                })}
                label={t('videoAnalyzer.model')}
              />

              <div className="relative h-48 overflow-y-scroll rounded-md border border-gray-200 bg-white p-1.5 xl:h-96">
                <Markdown>{typingTextOutput}</Markdown>
                {(loading || sending) && (
                  <div className="flex items-center justify-center py-4">
                    <Spinner />
                  </div>
                )}

                <div className="absolute bottom-3 right-3">
                  <Button
                    variant="secondary"
                    onClick={onClickClear}
                    disabled={loading || sending || content.length === 0}>
                    {t('videoAnalyzer.clear')}
                  </Button>
                </div>
              </div>
              <div className="mt-3">
                <InputChatContent
                  onSend={sendFrame}
                  disabled={
                    !recording || loading || sending || content.length === 0
                  }
                  loading={loading}
                  fullWidth={true}
                  disableMarginBottom={true}
                  hideReset={true}
                  content={content}
                  onChangeContent={setContent}
                />
              </div>
            </div>
          </div>
        </Card>
    </PageContainer>
  );
};

export default VideoAnalyzerPage;
