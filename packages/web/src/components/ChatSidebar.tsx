import React, { useState } from 'react';
import { BaseProps } from '../@types/common';
import { useNavigate, useLocation } from 'react-router-dom';
import { PiPlus, PiMagnifyingGlass } from 'react-icons/pi';
import ChatList from './ChatList';
import { useTranslation } from 'react-i18next';

type Props = BaseProps & {
  onNewChat?: () => void;
};

const ChatSidebar: React.FC<Props> = ({ onNewChat }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState('');

  const searchWords = searchQuery
    .split(' ')
    .filter((word) => word.trim().length > 0);

  const handleNewChat = () => {
    // If already on /chat page, just reset the chat
    if (location.pathname === '/chat' && onNewChat) {
      onNewChat();
    } else {
      // Otherwise, navigate to /chat
      navigate('/chat');
    }
  };

  return (
    <nav className="bg-aws-squid-ink flex h-screen w-64 flex-col text-sm text-white">
      {/* New Chat Button */}
      <div className="border-b border-gray-600 p-3">
        <button
          onClick={handleNewChat}
          className="hover:bg-aws-sky flex w-full items-center justify-center gap-2 rounded p-2 transition-colors">
          <PiPlus className="text-lg" />
          <span>{t('chat.button.newChat')}</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="border-b border-gray-600 p-3">
        <div className="relative">
          <PiMagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            className="w-full rounded bg-gray-700 py-2 pl-8 pr-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-aws-sky"
            placeholder={t('chat.search_by_title')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Chat History */}
      <div className="scrollbar-thin scrollbar-thumb-white flex-1 overflow-y-auto p-2">
        <ChatList searchWords={searchWords} />
      </div>
    </nav>
  );
};

export default ChatSidebar;
