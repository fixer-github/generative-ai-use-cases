import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  PiArrowLeft,
  PiInfo,
  PiTrash,
  PiDownloadSimple,
  PiRobot,
} from 'react-icons/pi';
import useAssistantApi from '../hooks/useAssistantApi';
import useChatApi from '../hooks/useChatApi';
import useHttp from '../hooks/useHttp';
import {
  Assistant,
  AssistantMessage,
  UnrecordedMessage,
  FindChatByIdResponse,
} from 'generative-ai-use-cases';
import Button from '../components/Button';
import LoadingWave from '../components/LoadingWave';
import ChatMessage from '../components/ChatMessage';
import InputChatContent from '../components/InputChatContent';
import SyncStatusBanner from '../components/assistants/SyncStatusBanner';
import AssistantModelDisplay from '../components/assistants/AssistantModelDisplay';
import AssistantInfoPanel from '../components/assistants/AssistantInfoPanel';
import {
  isSyncBlocking,
  isStatusFinal,
} from '../components/assistants/statusMetadata';
import { findModelByModelId } from '../hooks/useModel';
import { getPrompter } from '../prompts';

const AssistantChatPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { assistantId, conversationId } = useParams<{
    assistantId?: string;
    conversationId?: string;
  }>();

  const { getAssistant, listMessages, createMessage } = useAssistantApi();
  const { predictTitle, updateTitle } = useChatApi();
  const http = useHttp();

  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [showAssistantInfo, setShowAssistantInfo] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | undefined>(
    conversationId
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastLoadedChatId = useRef<string | undefined>();
  const latestFetchToken = useRef(0);
  const latestAssistantFetchToken = useRef(0);
  const latestAssistantPollToken = useRef(0);

  const isBlocked = useMemo(() => {
    return assistant?.ragEnabled && isSyncBlocking(assistant.syncStatus);
  }, [assistant]);

  // Fetch assistant info when assistantId changes
  useEffect(() => {
    if (!assistantId) return;
    fetchAssistant();
  }, [assistantId]);

  // Fetch messages when conversationId changes
  useEffect(() => {
    if (!assistantId) return;
    setCurrentChatId(conversationId);
    if (conversationId) {
      // Clear old conversation messages immediately and show loading
      setMessages([]);
      setLoadingMessages(true);
      fetchMessages(conversationId);
    } else {
      // Invalidate in-flight fetches and reset to empty state for new conversation
      latestFetchToken.current += 1;
      lastLoadedChatId.current = undefined;
      setLoadingMessages(false);
      setMessages([]);
    }
  }, [assistantId, conversationId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Polling for assistant with non-final sync status
  useEffect(() => {
    if (
      !assistantId ||
      !assistant ||
      assistant.assistantId !== assistantId ||
      !assistant.ragEnabled
    ) {
      return;
    }

    if (isStatusFinal(assistant.syncStatus)) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const requestToken = ++latestAssistantPollToken.current;
      try {
        const result = await getAssistant(assistantId);
        if (cancelled || requestToken !== latestAssistantPollToken.current) {
          return;
        }
        setAssistant((prev) => {
          // Show success toast when transitioning to SUCCEEDED
          if (
            prev &&
            prev.syncStatus !== 'SUCCEEDED' &&
            result.syncStatus === 'SUCCEEDED'
          ) {
            toast.success(t('assistant.chatPage.syncSucceeded'));
          }
          return result;
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to poll assistant status:', error);
        }
      }
    };

    const loop = async () => {
      await poll();
      if (!cancelled) {
        timer = setTimeout(loop, 5000);
      }
    };
    loop();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    assistantId,
    assistant?.ragEnabled,
    assistant?.syncStatus,
    getAssistant,
    t,
  ]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchAssistant = async () => {
    if (!assistantId) return;

    const requestToken = ++latestAssistantFetchToken.current;
    setLoading(true);
    try {
      const result = await getAssistant(assistantId);
      // Only update state if this is still the latest fetch
      if (latestAssistantFetchToken.current === requestToken) {
        setAssistant(result);
      }
    } catch (error) {
      console.error('Failed to fetch assistant:', error);
      // Redirect to assistants page if access is forbidden (403)
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status?: number } };
        if (axiosError.response?.status === 403) {
          navigate('/chat/assistants');
          return;
        }
      }
    } finally {
      if (latestAssistantFetchToken.current === requestToken) {
        setLoading(false);
      }
    }
  };

  const fetchMessages = async (chatIdOverride?: string) => {
    if (!assistantId) return;

    const requestToken = ++latestFetchToken.current;
    setLoadingMessages(true);

    try {
      const chatIdToLoad =
        chatIdOverride === undefined ? currentChatId : chatIdOverride;
      if (!chatIdToLoad) {
        if (latestFetchToken.current === requestToken) {
          setLoadingMessages(false);
        }
        return;
      }
      lastLoadedChatId.current = chatIdToLoad;

      const response = await listMessages(assistantId, {
        limit: 100,
        chatId: chatIdToLoad,
      });
      // Sort messages chronologically (oldest first)
      // Backend returns newest first (ScanIndexForward: false), so we reverse
      // Handle multiple timestamp formats: numeric string, messageId ULID prefix, or ISO date
      const extractTimestamp = (message: AssistantMessage): number => {
        const numericCreated = Number(message.createdDate);
        if (Number.isFinite(numericCreated)) return numericCreated;
        const idTimestamp = Number(message.messageId?.split('#')[0]);
        if (Number.isFinite(idTimestamp)) return idTimestamp;
        const parsed = Date.parse(message.createdDate ?? '');
        return Number.isNaN(parsed) ? 0 : parsed;
      };

      const sortedMessages = [...(response.messages || [])].sort(
        (a, b) => extractTimestamp(a) - extractTimestamp(b)
      );
      // Only update messages if this is still the latest fetch for the current chat
      if (
        latestFetchToken.current === requestToken &&
        lastLoadedChatId.current === chatIdToLoad
      ) {
        setMessages(sortedMessages);
      }
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      if (latestFetchToken.current === requestToken) {
        setLoadingMessages(false);
      }
    }
  };

  const generateChatTitle = async (newChatId: string) => {
    if (!assistant) return;

    try {
      // Fetch the latest messages for title generation
      const response = await listMessages(assistantId!, {
        limit: 10,
        chatId: newChatId,
      });

      // Need at least one user and one assistant message
      if (!response.messages || response.messages.length < 2) return;

      // Get chat data
      const chatResponse = await http.api.get<FindChatByIdResponse>(
        `chats/${newChatId}`
      );
      const chat = chatResponse.data.chat;

      if (
        chat.title &&
        chat.title.trim() !== '' &&
        chat.title !== assistant.name
      ) {
        // Title already exists and is not the default assistant name
        return;
      }

      // Sort messages chronologically for correct context
      const extractTimestamp = (message: AssistantMessage): number => {
        const numericCreated = Number(message.createdDate);
        if (Number.isFinite(numericCreated)) return numericCreated;
        const idTimestamp = Number(message.messageId?.split('#')[0]);
        if (Number.isFinite(idTimestamp)) return idTimestamp;
        const parsed = Date.parse(message.createdDate ?? '');
        return Number.isNaN(parsed) ? 0 : parsed;
      };

      const sortedForTitle = [...response.messages].sort(
        (a, b) => extractTimestamp(a) - extractTimestamp(b)
      );

      // Convert assistant messages to the format needed for title generation
      const messagesForTitle: UnrecordedMessage[] = sortedForTitle.map(
        (msg) => ({
          role: msg.role,
          content: msg.content,
        })
      );

      // Get the model and prompter for title generation
      const model = findModelByModelId(assistant.modelId);
      if (!model) return;

      const prompter = getPrompter(assistant.modelId);
      const titlePrompt = prompter.setTitlePrompt({
        messages: messagesForTitle,
      });

      // Generate title
      const title = await predictTitle({
        model,
        chat,
        prompt: titlePrompt,
        id: '/title',
      });

      // Update the title
      if (title && title.trim() !== '') {
        await updateTitle(newChatId, title);
      }
    } catch (error) {
      console.error('Failed to generate chat title:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !assistantId) return;

    // Block sending if sync is in blocking state
    if (isBlocked) {
      toast.warning(t('assistant.statusMessage.blocking'));
      return;
    }

    const userMessageContent = inputMessage;
    const isFirstMessage = !currentChatId;
    setSending(true);

    try {
      // Clear input only after successful send
      setInputMessage('');

      // Send message and get response
      const response = await createMessage(assistantId, {
        content: userMessageContent,
        chatId: currentChatId,
      });

      // If this was a new conversation (no currentChatId), update state and navigate
      if (!currentChatId && response.chatId) {
        const newChatId = response.chatId;
        setCurrentChatId(newChatId);
        // Navigate to the conversation URL
        navigate(`/chat/assistants/chat/${assistantId}/${newChatId}`, {
          replace: true,
        });
      }

      // Refresh messages to get both user and assistant messages
      await fetchMessages(response.chatId ?? currentChatId);

      // Generate title for the first message (fire-and-forget, don't block UI)
      if (isFirstMessage && response.chatId) {
        generateChatTitle(response.chatId).catch((err) =>
          console.error('Failed to generate chat title:', err)
        );
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      // Restore input text on failure so user can retry
      setInputMessage(userMessageContent);
      toast.error(t('assistant.chatPage.sendError'));
    } finally {
      setSending(false);
    }
  };

  const handleClearConversation = () => {
    if (window.confirm(t('assistant.chatPage.confirmClear'))) {
      // Just clear local messages - server will handle message history
      setMessages([]);
    }
  };

  const handleDownloadConversation = () => {
    const content = messages
      .map((msg) => `[${msg.role}]: ${msg.content}`)
      .join('\n\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${assistantId || 'unknown'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingWave />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col md:px-6 lg:px-8">
      {/* Status Banner */}
      {assistant?.ragEnabled && assistant.syncStatus !== 'SUCCEEDED' && (
        <div className="sticky top-0 z-30 bg-white">
          <SyncStatusBanner
            syncStatus={assistant.syncStatus}
            syncStatusReason={assistant.syncStatusReason}
            failedSourceCount={
              assistant.knowledgeSources?.filter(
                (source) => source.status === 'FAILED'
              ).length
            }
          />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 border-b bg-white py-3">
        <Button
          outlined
          onClick={() => navigate('/chat/assistants')}
          className="flex items-center gap-1">
          <PiArrowLeft />
        </Button>

        <div className="flex-1">
          {assistant ? (
            <AssistantModelDisplay
              assistantName={assistant.name}
              modelId={assistant.modelId}
            />
          ) : (
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <PiRobot />
              {t('assistant.chatPage.title')}
            </h1>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            outlined
            onClick={() => setShowAssistantInfo(!showAssistantInfo)}
            className="flex items-center gap-1">
            <PiInfo />
          </Button>
          <Button
            outlined
            onClick={handleDownloadConversation}
            disabled={messages.length === 0}
            className="flex items-center gap-1">
            <PiDownloadSimple />
          </Button>
          <Button
            outlined
            onClick={handleClearConversation}
            disabled={messages.length === 0}
            className="flex items-center gap-1">
            <PiTrash />
          </Button>
        </div>
      </div>

      {/* Assistant Info Panel */}
      {showAssistantInfo && assistant && (
        <AssistantInfoPanel assistant={assistant} className="m-4" />
      )}

      {/* Wrapper for messages and input to enable vertical centering when empty */}
      {loadingMessages && messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <LoadingWave />
        </div>
      ) : messages.length === 0 ? (
        sending ? (
          <div className="flex flex-1 items-center justify-center">
            <LoadingWave />
          </div>
        ) : (
          <div className="flex flex-1 flex-col justify-center">
            <InputChatContent
              className="mx-auto print:hidden"
              content={inputMessage}
              onChangeContent={setInputMessage}
              onSend={handleSendMessage}
              disabled={isBlocked}
              placeholder={
                isBlocked
                  ? t('assistant.chatPage.syncingPlaceholder')
                  : t('assistant.chatPage.inputPlaceholder')
              }
              loading={sending}
              hideReset={true}
              disableFileUpload={true}
            />
          </div>
        )
      ) : (
        <>
          <div className="flex-1 overflow-y-auto">
            {messages.map((message) => (
              <ChatMessage
                key={message.messageId}
                chatContent={{
                  role: message.role,
                  content: message.content,
                  createdDate: message.messageId,
                }}
                sources={message.sources}
                hideFeedback={true}
                allowRetry={false}
                editable={false}
              />
            ))}
            {sending && (
              <div className="flex justify-center py-4">
                <div className="flex w-11/12 gap-3 md:w-11/12 lg:w-5/6 xl:w-4/6">
                  <div className="bg-aws-ml h-min shrink-0 rounded-full p-1">
                    <div className="size-7 fill-white">
                      <PiRobot className="size-7 text-white" />
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-2xl bg-gray-100 px-4 py-3">
                    <LoadingWave />
                  </div>
                </div>
              </div>
            )}
            {loadingMessages && (
              <div className="flex justify-center py-2">
                <LoadingWave />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="sticky bottom-0 print:hidden">
            <InputChatContent
              className="mx-auto my-4"
              content={inputMessage}
              onChangeContent={setInputMessage}
              onSend={handleSendMessage}
              disabled={isBlocked}
              placeholder={
                isBlocked
                  ? t('assistant.chatPage.syncingPlaceholder')
                  : t('assistant.chatPage.inputPlaceholder')
              }
              loading={sending}
              hideReset={true}
              disableFileUpload={true}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default AssistantChatPage;
