import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ulid } from 'ulid';
import {
  PiArrowLeft,
  PiPaperPlaneTilt,
  PiRobot,
  PiUser,
  PiInfo,
  PiTrash,
  PiDownloadSimple,
  PiCopy,
} from 'react-icons/pi';
import useBedrockChatApi, {
  BedrockChatBot,
  BedrockChatMessage,
} from '../hooks/useBedrockChatApi';
import Button from '../components/Button';
import Card from '../components/Card';
import LoadingWave from '../components/LoadingWave';
import Markdown from '../components/Markdown';

interface Conversation {
  id: string;
  title: string;
  bot_id: string;
  messages: BedrockChatMessage[];
  created_at: string;
}

const RagChatBotChatPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { botId, conversationId } = useParams<{ botId?: string; conversationId?: string }>();
  
  const {
    getBotSummary,
    getConversation,
    sendMessage,
    deleteConversation,
  } = useBedrockChatApi();

  const [bot, setBot] = useState<BedrockChatBot | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<BedrockChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showBotInfo, setShowBotInfo] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (botId) {
      fetchBot();
    }
    if (conversationId) {
      fetchConversation();
    } else if (botId) {
      // Generate a new conversation ID for new chats
      const newConversationId = ulid();
      setConversation({
        id: newConversationId,
        title: `Chat with Bot ${botId}`,
        bot_id: botId,
        messages: [],
        created_at: new Date().toISOString(),
      });
      navigate(`/rag-chat-bot/chat/${botId}/${newConversationId}`, { replace: true });
    }
  }, [botId, conversationId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchBot = async () => {
    if (!botId) return;
    
    setLoading(true);
    try {
      const botData = await getBotSummary(botId);
      setBot(botData as unknown as BedrockChatBot);
    } catch (error) {
      console.error('Failed to fetch bot:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchConversation = async () => {
    if (!conversationId) return;
    
    setLoading(true);
    try {
      const conv = await getConversation(conversationId);
      setConversation(conv);
      setMessages(conv.messages || []);
    } catch (error) {
      console.error('Failed to fetch conversation:', error);
    } finally {
      setLoading(false);
    }
  };


  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !conversation) return;
    
    const userMessage: BedrockChatMessage = {
      id: `msg-${Date.now()}`,
      content: inputMessage,
      role: 'user',
      timestamp: new Date().toISOString(),
    };
    
    setMessages((prev) => [...prev, userMessage]);
    setInputMessage('');
    setSending(true);
    
    try {
      const response = await sendMessage(
        conversation.id,
        inputMessage,
        botId
      );
      
      // Extract text content from the response
      const messageContent = response.message.content
        .filter((item: any) => item.content_type === 'text')
        .map((item: any) => item.body)
        .join('\n');
      
      const assistantMessage: BedrockChatMessage = {
        id: response.message_id || `msg-${Date.now() + 1}`,
        content: messageContent,
        role: 'assistant',
        timestamp: new Date().toISOString(),
      };
      
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Failed to send message:', error);
      const errorMessage: BedrockChatMessage = {
        id: `msg-error-${Date.now()}`,
        content: t('ragChatBot.chatPage.sendError'),
        role: 'system',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearConversation = async () => {
    if (conversation && window.confirm(t('ragChatBot.chatPage.confirmClear'))) {
      try {
        await deleteConversation(conversation.id);
        // Generate a new conversation ID
        const newConversationId = ulid();
        setConversation({
          id: newConversationId,
          title: `Chat with Bot ${botId}`,
          bot_id: botId || '',
          messages: [],
          created_at: new Date().toISOString(),
        });
        setMessages([]);
        navigate(`/rag-chat-bot/chat/${botId}/${newConversationId}`, { replace: true });
      } catch (error) {
        console.error('Failed to clear conversation:', error);
      }
    }
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
    a.download = `conversation-${conversation?.id || 'unknown'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderMessage = (message: BedrockChatMessage) => {
    const isUser = message.role === 'user';
    const isSystem = message.role === 'system';
    
    return (
      <div
        key={message.id}
        className={`flex gap-3 mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}
      >
        {!isUser && (
          <div className="flex-shrink-0">
            {isSystem ? (
              <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center">
                <PiInfo className="text-yellow-600" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                <PiRobot className="text-blue-600" />
              </div>
            )}
          </div>
        )}
        
        <div
          className={`max-w-[70%] ${
            isUser
              ? 'bg-blue-600 text-white rounded-l-lg rounded-br-lg'
              : isSystem
              ? 'bg-yellow-50 text-yellow-900 rounded-lg border border-yellow-200'
              : 'bg-gray-100 text-gray-900 rounded-r-lg rounded-bl-lg'
          } p-3`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <Markdown>{message.content}</Markdown>
          )}
          
          {!isSystem && (
            <div className="mt-2 flex gap-2 justify-end">
              <button
                onClick={() => handleCopyMessage(message.content)}
                className="text-xs opacity-60 hover:opacity-100"
                title={t('ragChatBot.chatPage.copy')}
              >
                <PiCopy />
              </button>
            </div>
          )}
        </div>
        
        {isUser && (
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
              <PiUser className="text-green-600" />
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <LoadingWave />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="bg-white border-b px-4 py-3 flex items-center gap-4">
        <Button
          outlined
          onClick={() => navigate('/rag-chat-bot')}
          className="flex items-center gap-1"
        >
          <PiArrowLeft />
        </Button>
        
        <div className="flex-1">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <PiRobot />
            {bot?.title || t('ragChatBot.chatPage.title')}
          </h1>
          {bot?.description && (
            <p className="text-sm text-gray-600">{bot.description}</p>
          )}
        </div>
        
        <div className="flex gap-2">
          <Button
            outlined
            onClick={() => setShowBotInfo(!showBotInfo)}
            className="flex items-center gap-1"
          >
            <PiInfo />
          </Button>
          <Button
            outlined
            onClick={handleDownloadConversation}
            disabled={messages.length === 0}
            className="flex items-center gap-1"
          >
            <PiDownloadSimple />
          </Button>
          <Button
            outlined
            onClick={handleClearConversation}
            disabled={messages.length === 0}
            className="flex items-center gap-1"
          >
            <PiTrash />
          </Button>
        </div>
      </div>

      {showBotInfo && bot && (
        <Card className="m-4 p-4">
          <h3 className="font-semibold mb-2">{t('ragChatBot.chatPage.botInfo')}</h3>
          <div className="text-sm space-y-1">
            <p><strong>{t('ragChatBot.chatPage.instruction')}:</strong> {bot.instruction}</p>
            <p><strong>{t('ragChatBot.chatPage.syncStatus')}:</strong> {bot.syncStatus}</p>
            {bot.displayRetrievedChunks && (
              <p className="text-green-600">{t('ragChatBot.chatPage.chunksEnabled')}</p>
            )}
          </div>
        </Card>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="text-center py-12">
            <PiRobot className="text-6xl text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">{t('ragChatBot.chatPage.noMessages')}</p>
            {bot?.conversationQuickStarters && bot.conversationQuickStarters.length > 0 && (
              <div className="mt-6">
                <p className="text-sm text-gray-600 mb-3">{t('ragChatBot.chatPage.quickStarters')}</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {bot.conversationQuickStarters.map((starter: { title: string; example: string }, index: number) => (
                    <Button
                      key={index}
                      outlined
                      onClick={() => setInputMessage(starter.example)}
                      className="text-sm"
                    >
                      {starter.title}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            {messages.map(renderMessage)}
            {sending && (
              <div className="flex gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <PiRobot className="text-blue-600" />
                </div>
                <div className="bg-gray-100 rounded-r-lg rounded-bl-lg p-3">
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
            onKeyPress={handleKeyPress}
            placeholder={t('ragChatBot.chatPage.inputPlaceholder')}
            disabled={sending || !conversation}
            className="flex-1 rounded border border-black/30 p-1.5 outline-none"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputMessage.trim() || sending || !conversation}
            className="flex items-center gap-1"
          >
            <PiPaperPlaneTilt />
            {t('ragChatBot.chatPage.send')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RagChatBotChatPage;