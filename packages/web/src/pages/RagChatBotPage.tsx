import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PiPlus,
  PiMagnifyingGlass,
  PiRobot,
  PiStar,
  PiStarFill,
  PiChatCircleText,
  PiPencil,
  PiTrash,
  PiShareNetwork,
  PiCaretDown,
  PiUser,
} from 'react-icons/pi';
import useBedrockChatApi, { BedrockChatBot } from '../hooks/useBedrockChatApi';
import Button from '../components/Button';
import Card from '../components/Card';
import Select from '../components/Select';
import Switch from '../components/Switch';
import LoadingWave from '../components/LoadingWave';

type ViewMode = 'popular' | 'search' | 'mybot' | 'all';
type FilterOption = 'all' | 'private' | 'public' | 'starred';

const RagChatBotPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getAllBots, setStarredStatus, deleteBot } = useBedrockChatApi();

  const [bots, setBots] = useState<BedrockChatBot[]>([]);
  const [filteredBots, setFilteredBots] = useState<BedrockChatBot[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('popular');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOption, setFilterOption] = useState<FilterOption>('all');
  const [showOnlyStarred, setShowOnlyStarred] = useState(false);

  const fetchBots = useCallback(async () => {
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

      const data = await getAllBots(params);
      setBots(data || []);
    } catch (error) {
      console.error('Failed to fetch bots:', error);
      setBots([]);
    } finally {
      setLoading(false);
    }
  }, [viewMode, showOnlyStarred, getAllBots]);

  useEffect(() => {
    fetchBots();
  }, [fetchBots]);

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
      filtered = filtered.filter((bot) => bot.shared_scope === 'private');
    } else if (filterOption === 'public') {
      filtered = filtered.filter((bot) => bot.shared_scope !== 'private');
    } else if (filterOption === 'starred') {
      filtered = filtered.filter((bot) => bot.is_starred);
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
      await fetchBots();
    } catch (error) {
      console.error('Failed to toggle star status:', error);
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

  const renderBotCard = (bot: BedrockChatBot) => {
    const isOwner = bot.owner_user_id === 'current_user'; // TODO: Get actual current user ID
    
    return (
      <Card key={bot.id} className="mb-4 hover:shadow-lg transition-shadow">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <PiRobot className="text-2xl text-blue-600" />
              <h3 className="text-lg font-semibold">{bot.title}</h3>
              {bot.shared_scope !== 'private' && (
                <PiShareNetwork className="text-gray-500" title={t('ragChatBot.shared')} />
              )}
              {bot.is_starred && (
                <PiStarFill className="text-yellow-500" />
              )}
            </div>
            {bot.description && (
              <p className="text-gray-600 text-sm mb-3">{bot.description}</p>
            )}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {bot.last_used_time && (
                <span>
                  {t('ragChatBot.lastUsed')}: {new Date(bot.last_used_time * 1000).toLocaleDateString()}
                </span>
              )}
              {bot.sync_status && (
                <span className="px-2 py-1 bg-gray-100 rounded">
                  {bot.sync_status}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              outlined
              onClick={() => handleChatWithBot(bot.id)}
              className="text-sm flex items-center gap-1"
            >
              <PiChatCircleText />
              {t('ragChatBot.chat')}
            </Button>
            {isOwner && (
              <>
                <Button
                  outlined
                  onClick={() => handleEditBot(bot.id)}
                  className="text-sm"
                >
                  <PiPencil />
                </Button>
                <Button
                  outlined
                  onClick={() => handleToggleStar(bot.id, bot.is_starred)}
                  className="text-sm"
                >
                  {bot.is_starred ? <PiStarFill /> : <PiStar />}
                </Button>
                <Button
                  outlined
                  onClick={() => handleDeleteBot(bot.id)}
                  className="text-sm text-red-600 hover:bg-red-50"
                >
                  <PiTrash />
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>
    );
  };

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
            onKeyPress={(e: React.KeyboardEvent) => e.key === 'Enter' && handleSearch()}
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
        
        <Select
          label={t('ragChatBot.filter')}
          value={filterOption}
          onChange={(val: string) => setFilterOption(val as FilterOption)}
          options={[
            { value: 'all', label: t('ragChatBot.filterAll') },
            { value: 'private', label: t('ragChatBot.filterPrivate') },
            { value: 'public', label: t('ragChatBot.filterPublic') },
            { value: 'starred', label: t('ragChatBot.filterStarred') },
          ]}
        />

        <div className="flex items-center gap-2">
          <Switch
            checked={showOnlyStarred}
            onSwitch={setShowOnlyStarred}
            label={t('ragChatBot.showStarredOnly')}
          />
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