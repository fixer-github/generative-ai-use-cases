import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PiArrowLeft,
  PiChatCircleText,
  PiCalendar,
  PiRobot,
} from 'react-icons/pi';
import useAssistantApi from '../hooks/useAssistantApi';
import type { Assistant } from 'generative-ai-use-cases';
import Button from '../components/Button';
import Card from '../components/Card';
import LoadingWave from '../components/LoadingWave';

const RagChatBotHistoryPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { listAssistants } = useAssistantApi();

  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchAssistants();
  }, []);

  const fetchAssistants = async () => {
    setLoading(true);
    try {
      const data = await listAssistants({ limit: 100 });
      // Sort by most recently updated first
      const sorted = (data.assistants || []).sort(
        (a: Assistant, b: Assistant) => {
          return (
            new Date(b.updatedDate).getTime() -
            new Date(a.updatedDate).getTime()
          );
        }
      );
      setAssistants(sorted);
    } catch (error) {
      console.error('Failed to fetch assistants:', error);
      setAssistants([]);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAssistant = (assistant: Assistant) => {
    navigate(`/rag-chat-bot/chat/${assistant.assistantId}`);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours === 0) {
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        return t('ragChatBot.history.minutesAgo', { minutes: diffMinutes });
      }
      return t('ragChatBot.history.hoursAgo', { hours: diffHours });
    } else if (diffDays === 1) {
      return t('ragChatBot.history.yesterday');
    } else if (diffDays < 7) {
      return t('ragChatBot.history.daysAgo', { days: diffDays });
    } else {
      return date.toLocaleDateString();
    }
  };

  const renderAssistantCard = (assistant: Assistant) => {
    return (
      <div
        key={assistant.assistantId}
        onClick={() => handleOpenAssistant(assistant)}
        className="cursor-pointer">
        <Card className="mb-4 transition-shadow hover:shadow-lg">
          <div className="flex items-start justify-between">
            <div className="flex flex-1 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
                <PiRobot className="text-xl text-blue-600" />
              </div>

              <div className="flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="text-lg font-semibold">{assistant.name}</h3>
                </div>

                {assistant.description && (
                  <p className="mb-2 text-sm text-gray-600">
                    {assistant.description}
                  </p>
                )}

                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span className="flex items-center gap-1">
                    <PiCalendar />
                    {t('ragChatBot.history.created', 'Created')}:{' '}
                    {formatDate(assistant.createdDate)}
                  </span>
                  <span className="flex items-center gap-1">
                    {t('ragChatBot.history.updated', 'Updated')}:{' '}
                    {formatDate(assistant.updatedDate)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
              <Button
                outlined
                onClick={() => {
                  handleOpenAssistant(assistant);
                }}
                className="flex items-center gap-1 text-sm">
                <PiChatCircleText />
                {t('ragChatBot.history.open')}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center gap-4">
        <Button
          outlined
          onClick={() => navigate('/rag-chat-bot')}
          className="flex items-center gap-1">
          <PiArrowLeft />
          {t('ragChatBot.history.back')}
        </Button>
        <h1 className="flex-1 text-2xl font-bold">
          {t('ragChatBot.history.title')}
        </h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingWave />
        </div>
      ) : assistants.length === 0 ? (
        <div className="py-12 text-center">
          <PiChatCircleText className="mx-auto mb-4 text-6xl text-gray-300" />
          <p className="text-gray-500">
            {t(
              'ragChatBot.history.noAssistants',
              'No assistants found. Create one to get started!'
            )}
          </p>
        </div>
      ) : (
        <div>
          <div className="mb-4 text-sm text-gray-600">
            {t('ragChatBot.history.showing', {
              count: assistants.length,
            })}
          </div>
          {assistants.map((assistant) => renderAssistantCard(assistant))}
        </div>
      )}
    </div>
  );
};

export default RagChatBotHistoryPage;
