import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PiArrowLeft,
  PiPaperPlaneTilt,
  PiRobot,
  PiUser,
  PiInfo,
  PiDownloadSimple,
  PiCopy,
} from 'react-icons/pi';
import useAssistantApi from '../hooks/useAssistantApi';
import type {
  Assistant,
  AssistantMessage,
  AssistantMessageSource,
} from 'generative-ai-use-cases';
import Button from '../components/Button';
import Card from '../components/Card';
import LoadingWave from '../components/LoadingWave';
import Markdown from '../components/Markdown';

const RagChatBotChatPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { botId: assistantId } = useParams<{ botId?: string }>();

  const { getAssistant, listMessages, createMessage } = useAssistantApi();

  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showAssistantInfo, setShowAssistantInfo] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (assistantId) {
      fetchAssistant();
      fetchMessages();
    }
  }, [assistantId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchAssistant = async () => {
    if (!assistantId) return;

    setLoading(true);
    try {
      const assistantData = await getAssistant(assistantId);
      setAssistant(assistantData);
    } catch (error) {
      console.error('Failed to fetch assistant:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async () => {
    if (!assistantId) return;

    try {
      const { messages: fetchedMessages } = await listMessages(assistantId, {
        limit: 100,
      });
      setMessages(fetchedMessages || []);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !assistantId) return;

    const userMessageContent = inputMessage;
    setInputMessage('');
    setSending(true);

    try {
      await createMessage(assistantId, {
        content: userMessageContent,
      });

      // Fetch all messages to get both user message and assistant response
      await fetchMessages();
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Failed to send message. Please try again.');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = () => {
    setIsComposing(false);
  };

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
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

  const renderMessage = (message: AssistantMessage) => {
    const isUser = message.role === 'user';

    return (
      <div
        key={message.messageId}
        className={`mb-4 flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
        {!isUser && (
          <div className="shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
              <PiRobot className="text-blue-600" />
            </div>
          </div>
        )}

        <div
          className={`max-w-[70%] ${
            isUser
              ? 'rounded-l-lg rounded-br-lg bg-blue-600 text-white'
              : 'rounded-r-lg rounded-bl-lg bg-gray-100 text-gray-900'
          } p-3`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <>
              <Markdown>{message.content}</Markdown>
              {message.sources && message.sources.length > 0 && (
                <div className="mt-3 border-t border-gray-300 pt-3">
                  <p className="mb-2 text-xs font-semibold text-gray-600">
                    {t('ragChatBot.chatPage.sources', 'Sources')}:
                  </p>
                  {message.sources.map(
                    (source: AssistantMessageSource, idx: number) => (
                      <div
                        key={idx}
                        className="mb-2 rounded bg-white p-2 text-xs">
                        <p className="mb-1 font-mono text-gray-500">
                          {source.s3Url}
                        </p>
                        <p className="text-gray-700">{source.excerpt}</p>
                      </div>
                    )
                  )}
                </div>
              )}
            </>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => handleCopyMessage(message.content)}
              className="text-xs opacity-60 hover:opacity-100"
              title={t('ragChatBot.chatPage.copy')}>
              <PiCopy />
            </button>
          </div>
        </div>

        {isUser && (
          <div className="shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
              <PiUser className="text-green-600" />
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingWave />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-4 border-b bg-white px-4 py-3">
        <Button
          outlined
          onClick={() => navigate('/rag-chat-bot')}
          className="flex items-center gap-1">
          <PiArrowLeft />
        </Button>

        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <PiRobot />
            {assistant?.name || t('ragChatBot.chatPage.title')}
          </h1>
          {assistant?.description && (
            <p className="text-sm text-gray-600">{assistant.description}</p>
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
        </div>
      </div>

      {showAssistantInfo && assistant && (
        <Card className="m-4 p-4">
          <h3 className="mb-2 font-semibold">
            {t('ragChatBot.chatPage.botInfo')}
          </h3>
          <div className="space-y-1 text-sm">
            <p>
              <strong>{t('ragChatBot.chatPage.instruction')}:</strong>{' '}
              {assistant.instruction}
            </p>
            <p>
              <strong>
                {t('ragChatBot.chatPage.model', 'Model')}:
              </strong>{' '}
              {assistant.modelId}
            </p>
            <p>
              <strong>
                {t('ragChatBot.chatPage.ragEnabled', 'RAG Enabled')}:
              </strong>{' '}
              {assistant.ragEnabled ? 'Yes' : 'No'}
            </p>
            <p>
              <strong>{t('ragChatBot.chatPage.syncStatus')}:</strong>{' '}
              {assistant.syncStatus}
            </p>
          </div>
        </Card>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="py-12 text-center">
            <PiRobot className="mx-auto mb-4 text-6xl text-gray-300" />
            <p className="text-gray-500">
              {t('ragChatBot.chatPage.noMessages')}
            </p>
          </div>
        ) : (
          <div>
            {messages.map(renderMessage)}
            {sending && (
              <div className="mb-4 flex gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                  <PiRobot className="text-blue-600" />
                </div>
                <div className="rounded-r-lg rounded-bl-lg bg-gray-100 p-3">
                  <LoadingWave />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t bg-white p-4">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder={t('ragChatBot.chatPage.inputPlaceholder')}
            disabled={sending || !assistant}
            className="flex-1 rounded border border-black/30 p-1.5 outline-none"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputMessage.trim() || sending || !assistant}
            className="flex items-center gap-1">
            <PiPaperPlaneTilt />
            {t('ragChatBot.chatPage.send')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RagChatBotChatPage;
