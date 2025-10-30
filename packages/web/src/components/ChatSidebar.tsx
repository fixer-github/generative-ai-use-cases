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
    <nav className="bg-gray-50 border-r border-gray-200 flex h-screen w-64 flex-col text-sm text-gray-900">
      {/* New Chat Button */}
      <div className="border-b border-gray-200 p-4">
        <button
          onClick={handleNewChat}
          className="bg-blue-600 hover:bg-blue-700 text-white flex w-full items-center justify-center gap-2 rounded-lg px-6 py-2.5 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
          <PiPlus className="text-lg" strokeWidth={2} />
          <span>{t('chat.button.newChat')}</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="border-b border-gray-200 p-4">
        <div className="relative">
          <PiMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            className="w-full rounded-lg bg-white border border-gray-300 py-2.5 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
            placeholder={t('chat.search_by_title')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Chat History */}
      <div className="scrollbar-thin scrollbar-thumb-gray-400 flex-1 overflow-y-auto p-2">
        <ChatList searchWords={searchWords} />
      </div>
    </nav>
  );
};

export default ChatSidebar;
