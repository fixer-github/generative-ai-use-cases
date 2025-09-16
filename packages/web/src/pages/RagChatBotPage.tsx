import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PiPlus,
  PiMagnifyingGlass,
  PiRobot,
  PiStar,
  PiStarFill,
  PiPencil,
  PiTrash,
  PiShareNetwork,
  PiCaretDown,
  PiUser,
  PiDotsThreeVertical,
  PiCheckCircle,
  PiClockCountdown,
  PiWarningCircle,
} from 'react-icons/pi';
import useBedrockChatApi, { BedrockChatBot } from '../hooks/useBedrockChatApi';
import Button from '../components/Button';
import LoadingWave from '../components/LoadingWave';

type ViewMode = 'popular' | 'search' | 'mybot' | 'all';
type FilterOption = 'all' | 'private' | 'public' | 'starred';

const RagChatBotPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getAllBots, setStarredStatus, deleteBot, getPrivateBot } = useBedrockChatApi();

  const [bots, setBots] = useState<BedrockChatBot[]>([]);
  const [filteredBots, setFilteredBots] = useState<BedrockChatBot[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('popular');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOption] = useState<FilterOption>('all');
  const [showOnlyStarred] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchBots = useCallback(async () => {
    // Cancel previous request if it exists
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLoading(true);
    try {
      let params = {};
      if (viewMode === 'popular') {
        params = { kind: 'mixed', limit: 10 };
      } else if (viewMode === 'mybot') {
        params = { kind: 'private' };
      } else if (viewMode === 'all') {
        params = { kind: 'mixed', limit: 100 };
      } else if (viewMode === 'search') {
        params = { kind: 'mixed' };
      }

      if (showOnlyStarred) {
        params = { ...params, starred: true };
      }

      const data = await getAllBots(params, signal);
      // Only update state if request wasn't cancelled
      if (!signal.aborted) {
        setBots(data || []);
      }
    } catch (error) {
      // Only update state if request wasn't cancelled
      if (!abortControllerRef.current?.signal.aborted) {
        console.error('Failed to fetch bots:', error);
        setBots([]);
      }
    } finally {
      // Only set loading to false if request wasn't cancelled
      if (!abortControllerRef.current?.signal.aborted) {
        setLoading(false);
      }
    }
  }, [viewMode, showOnlyStarred, getAllBots]);

  // Function to update only sync status without full reload
  const updateSyncStatuses = useCallback(async () => {
    const botsToUpdate = bots.filter(bot => 
      bot.syncStatus !== 'RUNNING' && bot.syncStatus !== 'IDLE' && bot.syncStatus !== 'SUCCEEDED'
    );

    if (botsToUpdate.length === 0) return;

    try {
      const updates = await Promise.all(
        botsToUpdate.map(async (bot) => {
          try {
            const updatedBot = await getPrivateBot(bot.id);
            return { id: bot.id, syncStatus: updatedBot.syncStatus };
          } catch (error) {
            console.error(`Failed to update sync status for bot ${bot.id}:`, error);
            return null;
          }
        })
      );

      setBots(prevBots => 
        prevBots.map(bot => {
          const update = updates.find(u => u && u.id === bot.id);
          return update ? { ...bot, syncStatus: update.syncStatus } : bot;
        })
      );
    } catch (error) {
      console.error('Failed to update sync statuses:', error);
    }
  }, [bots, getPrivateBot]);

  useEffect(() => {
    fetchBots();
  }, [fetchBots]);

  // Polling for sync status
  useEffect(() => {
    const shouldPoll = filteredBots.some(bot => 
      bot.syncStatus !== 'RUNNING' && bot.syncStatus !== 'IDLE' && bot.syncStatus !== 'SUCCEEDED'
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
  }, [filteredBots, updateSyncStatuses]);

  useEffect(() => {
    let filtered = [...bots];

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(
        (bot) =>
          bot.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          bot.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply filter option
    if (filterOption === 'private') {
      filtered = filtered.filter((bot) => bot.sharedScope === 'private');
    } else if (filterOption === 'public') {
      filtered = filtered.filter((bot) => bot.sharedScope !== 'private');
    } else if (filterOption === 'starred') {
      filtered = filtered.filter((bot) => bot.isStarred);
    }

    setFilteredBots(filtered);
  }, [bots, searchQuery, filterOption]);

  const handleSearch = () => {
    if (searchQuery) {
      setViewMode('search');
    }
  };

  const handleCreateBot = () => {
    navigate('/rag-chat-bot/create');
  };

  const handleEditBot = (botId: string) => {
    navigate(`/rag-chat-bot/edit/${botId}`);
  };

  const handleChatWithBot = (botId: string) => {
    navigate(`/rag-chat-bot/chat/${botId}`);
  };

  const handleToggleStar = async (botId: string, currentStarred?: boolean) => {
    try {
      await setStarredStatus(botId, !currentStarred);
      // Update only the specific bot instead of refetching all
      setBots(prevBots => 
        prevBots.map(bot => 
          bot.id === botId ? { ...bot, isStarred: !currentStarred } : bot
        )
      );
    } catch (error) {
      console.error('Failed to toggle star status:', error);
      // Rollback on error
      await fetchBots();
    }
  };

  const handleDeleteBot = async (botId: string) => {
    if (window.confirm(t('ragChatBot.confirmDelete'))) {
      try {
        await deleteBot(botId);
        await fetchBots();
      } catch (error) {
        console.error('Failed to delete bot:', error);
      }
    }
  };

  const getSyncStatusDisplay = (status: string) => {
    switch (status) {
      case 'SUCCEEDED':
      case 'IDLE':
        return {
          text: t('ragChatBot.syncStatus.completed'),
          icon: <PiCheckCircle className="text-green-600" />,
          className: 'text-green-600',
        };
      case 'RUNNING':
        return {
          text: t('ragChatBot.syncStatus.syncing'),
          icon: <PiClockCountdown className="text-blue-600 animate-pulse" />,
          className: 'text-blue-600',
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

  const renderBotCard = (bot: BedrockChatBot) => {
    const isOwner = bot.owned === true;
    const syncStatusDisplay = getSyncStatusDisplay(bot.syncStatus);
    const isMenuOpen = openMenuId === bot.id;
    
    return (
      <div
        key={bot.id}
        className="mb-4 hover:shadow-lg transition-shadow cursor-pointer relative border-aws-font-color/20 rounded-lg border p-5 shadow"
        onClick={(e) => {
          // Check if click is on card itself, not on buttons
          const target = e.target as HTMLElement;
          if (!target.closest('button')) {
            handleChatWithBot(bot.id);
          }
        }}
      >
        <div className="flex items-stretch justify-between h-full">
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <PiRobot className="text-2xl text-blue-600" />
                <h3 className="text-lg font-semibold">{bot.title}</h3>
                {bot.sharedScope !== 'private' && (
                  <PiShareNetwork className="text-gray-500" title={t('ragChatBot.shared')} />
                )}
              </div>
              {bot.description && (
                <p className="text-gray-600 text-sm">{bot.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-4">
            {/* Sync Status Display */}
            <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded">
              {syncStatusDisplay.icon}
              <span className={`text-xs font-medium ${syncStatusDisplay.className}`}>
                {syncStatusDisplay.text}
              </span>
            </div>
            
            {/* Star Button */}
            {(bot.isStarred || isOwner) && (
              <div onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => handleToggleStar(bot.id, bot.isStarred)}
                  className="p-2 hover:bg-gray-100 rounded transition-colors"
                >
                  {bot.isStarred ? (
                    <PiStarFill className="text-yellow-500 text-xl" />
                  ) : (
                    <PiStar className="text-gray-500 text-xl hover:text-gray-700" />
                  )}
                </button>
              </div>
            )}
            
            {/* Three Dots Menu */}
            {isOwner && (
              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setOpenMenuId(isMenuOpen ? null : bot.id)}
                  className="p-2 hover:bg-gray-100 rounded transition-colors"
                >
                  <PiDotsThreeVertical className="text-gray-500 text-xl hover:text-gray-700" />
                </button>
                {isMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-10">
                    <button
                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center gap-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditBot(bot.id);
                        setOpenMenuId(null);
                      }}
                    >
                      <PiPencil /> {t('ragChatBot.editTitle')}
                    </button>
                    <button
                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center gap-2 text-red-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteBot(bot.id);
                        setOpenMenuId(null);
                      }}
                    >
                      <PiTrash /> {t('ragChatBot.delete')}
                    </button>
                  </div>
                )}
              </div>
            )}
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

  // Cleanup AbortController on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t('ragChatBot.title')}</h1>
        <p className="text-gray-600">{t('ragChatBot.description')}</p>
      </div>

      <div className="mb-6 flex flex-wrap gap-4 items-center">
        <div className="flex-1 flex gap-2">
          <input
            type="text"
            placeholder={t('ragChatBot.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && handleSearch()}
            className="flex-1 rounded border border-black/30 p-1.5 outline-none"
          />
          <Button
            onClick={handleSearch}
            outlined
            className="flex items-center gap-1"
          >
            <PiMagnifyingGlass />
            {t('ragChatBot.search')}
          </Button>
        </div>

        <Button
          onClick={handleCreateBot}
          className="flex items-center gap-1"
        >
          <PiPlus />
          {t('ragChatBot.createNew')}
        </Button>
      </div>

      <div className="mb-6 flex gap-2">
        <Button
          outlined={viewMode !== 'popular'}
          onClick={() => setViewMode('popular')}
        >
          {t('ragChatBot.popularBots')}
        </Button>
        <Button
          outlined={viewMode !== 'mybot'}
          onClick={() => setViewMode('mybot')}
          className="flex items-center gap-1"
        >
          <PiUser />
          {t('ragChatBot.myBots')}
        </Button>
        <Button
          outlined={viewMode !== 'all'}
          onClick={() => setViewMode('all')}
        >
          {t('ragChatBot.allBots')}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingWave />
        </div>
      ) : filteredBots.length === 0 ? (
        <div className="text-center py-12">
          <PiRobot className="text-6xl text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">{t('ragChatBot.noBots')}</p>
        </div>
      ) : (
        <div>
          {filteredBots.map((bot) => renderBotCard(bot))}
          {viewMode === 'popular' && filteredBots.length >= 10 && (
            <div className="text-center mt-6">
              <Button
                outlined
                onClick={() => setViewMode('all')}
                className="flex items-center gap-1"
              >
                <PiCaretDown />
                {t('ragChatBot.viewMore')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RagChatBotPage;