import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PiPlus,
  PiRobot,
  PiPencil,
  PiTrash,
  PiDotsThreeVertical,
  PiCheckCircle,
  PiClockCountdown,
  PiWarningCircle,
} from 'react-icons/pi';
import useAssistantApi from '../hooks/useAssistantApi';
import type { Assistant } from 'generative-ai-use-cases';
import Button from '../components/Button';
import LoadingWave from '../components/LoadingWave';

const RagChatBotPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { listAssistants, deleteAssistant, getAssistant } = useAssistantApi();

  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);

  const fetchAssistants = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAssistants({ limit: 50 });
      setAssistants(data.assistants || []);
    } catch (error) {
      console.error('Failed to fetch assistants:', error);
      setAssistants([]);
    } finally {
      setLoading(false);
    }
  }, [listAssistants]);

  // Function to update only sync status without full reload
  const updateSyncStatuses = useCallback(async () => {
    const assistantsToUpdate = assistants.filter(
      (assistant) => assistant.syncStatus === 'SYNCING'
    );

    if (assistantsToUpdate.length === 0) return;

    try {
      const updates = await Promise.all(
        assistantsToUpdate.map(async (assistant) => {
          try {
            const updatedAssistant = await getAssistant(assistant.assistantId);
            return {
              assistantId: assistant.assistantId,
              syncStatus: updatedAssistant.syncStatus,
            };
          } catch (error) {
            console.error(
              `Failed to update sync status for assistant ${assistant.assistantId}:`,
              error
            );
            return null;
          }
        })
      );

      setAssistants((prevAssistants) =>
        prevAssistants.map((assistant) => {
          const update = updates.find(
            (u) => u && u.assistantId === assistant.assistantId
          );
          return update
            ? { ...assistant, syncStatus: update.syncStatus }
            : assistant;
        })
      );
    } catch (error) {
      console.error('Failed to update sync statuses:', error);
    }
  }, [assistants, getAssistant]);

  // Fetch assistants on mount
  useEffect(() => {
    fetchAssistants();
  }, [fetchAssistants]);

  // Polling for sync status
  useEffect(() => {
    const shouldPoll = assistants.some(
      (assistant) => assistant.syncStatus === 'SYNCING'
    );

    if (shouldPoll) {
      pollingInterval.current = setInterval(() => {
        updateSyncStatuses();
      }, 10000); // Poll every 10 seconds
    } else {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
        pollingInterval.current = null;
      }
    }

    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    };
  }, [assistants, updateSyncStatuses]);

  const handleCreateAssistant = () => {
    navigate('/rag-chat-bot/create');
  };

  const handleEditAssistant = (assistantId: string) => {
    navigate(`/rag-chat-bot/edit/${assistantId}`);
  };

  const handleChatWithAssistant = (assistantId: string) => {
    navigate(`/rag-chat-bot/chat/${assistantId}`);
  };

  const handleDeleteAssistant = async (assistantId: string) => {
    if (window.confirm(t('ragChatBot.confirmDelete'))) {
      try {
        await deleteAssistant(assistantId);
        await fetchAssistants();
      } catch (error) {
        console.error('Failed to delete assistant:', error);
      }
    }
  };

  const getSyncStatusDisplay = (
    status: 'QUEUED' | 'SYNCING' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL'
  ) => {
    switch (status) {
      case 'SUCCEEDED':
        return {
          text: t('ragChatBot.syncStatus.completed'),
          icon: <PiCheckCircle className="text-green-600" />,
          className: 'text-green-600',
        };
      case 'SYNCING':
      case 'QUEUED':
        return {
          text: t('ragChatBot.syncStatus.syncing'),
          icon: <PiClockCountdown className="animate-pulse text-blue-600" />,
          className: 'text-blue-600',
        };
      case 'PARTIAL':
        return {
          text: t('ragChatBot.syncStatus.partial'),
          icon: <PiWarningCircle className="text-yellow-600" />,
          className: 'text-yellow-600',
        };
      case 'FAILED':
        return {
          text: t('ragChatBot.syncStatus.failed'),
          icon: <PiWarningCircle className="text-red-600" />,
          className: 'text-red-600',
        };
      default:
        return {
          text: status,
          icon: null,
          className: 'text-gray-500',
        };
    }
  };

  const renderAssistantCard = (assistant: Assistant) => {
    const syncStatusDisplay = getSyncStatusDisplay(assistant.syncStatus);
    const isMenuOpen = openMenuId === assistant.assistantId;

    return (
      <div
        key={assistant.assistantId}
        className="border-aws-font-color/20 relative mb-4 cursor-pointer rounded-lg border p-5 shadow transition-shadow hover:shadow-lg"
        onClick={(e) => {
          // Check if click is on card itself, not on buttons
          const target = e.target as HTMLElement;
          if (!target.closest('button')) {
            handleChatWithAssistant(assistant.assistantId);
          }
        }}>
        <div className="flex h-full items-stretch justify-between">
          <div className="flex flex-1 flex-col justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <PiRobot className="text-2xl text-blue-600" />
                <h3 className="text-lg font-semibold">{assistant.name}</h3>
              </div>
              {assistant.description && (
                <p className="text-sm text-gray-600">{assistant.description}</p>
              )}
            </div>
          </div>
          <div className="ml-4 flex items-center gap-2">
            {/* Sync Status Display */}
            <div className="flex items-center gap-1 rounded bg-gray-100 px-2 py-1">
              {syncStatusDisplay.icon}
              <span
                className={`text-xs font-medium ${syncStatusDisplay.className}`}>
                {syncStatusDisplay.text}
              </span>
            </div>

            {/* Three Dots Menu */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() =>
                  setOpenMenuId(isMenuOpen ? null : assistant.assistantId)
                }
                className="rounded p-2 transition-colors hover:bg-gray-100">
                <PiDotsThreeVertical className="text-xl text-gray-500 hover:text-gray-700" />
              </button>
              {isMenuOpen && (
                <div className="absolute right-0 z-10 mt-2 w-48 rounded-md border border-gray-200 bg-white shadow-lg">
                  <button
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-gray-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditAssistant(assistant.assistantId);
                      setOpenMenuId(null);
                    }}>
                    <PiPencil /> {t('ragChatBot.editTitle')}
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteAssistant(assistant.assistantId);
                      setOpenMenuId(null);
                    }}>
                    <PiTrash /> {t('ragChatBot.delete')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setOpenMenuId(null);
    };

    if (openMenuId) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [openMenuId]);

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="mb-2 text-3xl font-bold">{t('ragChatBot.title')}</h1>
          <p className="text-gray-600">{t('ragChatBot.description')}</p>
        </div>
        <Button
          onClick={handleCreateAssistant}
          className="flex items-center gap-1">
          <PiPlus />
          {t('ragChatBot.createNew')}
        </Button>
      </div>

      {/* Assistant list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingWave />
        </div>
      ) : assistants.length === 0 ? (
        <div className="py-12 text-center">
          <PiRobot className="mx-auto mb-4 text-6xl text-gray-300" />
          <p className="text-gray-500">{t('ragChatBot.noBots')}</p>
        </div>
      ) : (
        <div>{assistants.map((assistant) => renderAssistantCard(assistant))}</div>
      )}
    </div>
  );
};

export default RagChatBotPage;
