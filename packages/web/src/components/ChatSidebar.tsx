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
    <nav className="bg-gray-50 flex h-screen w-64 flex-col text-sm text-gray-900">
      {/* New Chat Button */}
      <div className="border-b border-gray-200 p-3">
        <button
          onClick={handleNewChat}
          className="hover:bg-blue-50 flex w-full items-center justify-center gap-2 rounded bg-blue-600 text-white p-2 transition-colors">
          <PiPlus className="text-lg" />
          <span>{t('chat.button.newChat')}</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="border-b border-gray-200 p-3">
        <div className="relative">
          <PiMagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            className="w-full rounded bg-white border border-gray-200 py-2 pl-8 pr-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder={t('chat.search_by_title')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Chat History */}
      <div className="scrollbar-thin scrollbar-thumb-gray-300 flex-1 overflow-y-auto p-2">
        <ChatList searchWords={searchWords} />
      </div>
    </nav>
  );
};

export default ChatSidebar;
