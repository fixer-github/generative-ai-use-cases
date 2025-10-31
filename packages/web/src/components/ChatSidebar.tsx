import React from 'react';
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
          className="hover:bg-blue-700 flex w-full items-center justify-center gap-2 rounded bg-blue-600 text-white p-2 transition-colors">
          <PiPlus className="text-lg" />
          <span>{t('chat.button.newChat')}</span>
        </button>
      </div>

      {/* Assistants Section */}
      {/* Temporarily hidden until backend support is implemented */}
      {/* <div className="border-b border-gray-200 p-3">
        <div className="mb-2 text-xs font-semibold text-gray-600">
          アシスタント
        </div>
        <button className="hover:bg-gray-100 flex w-full items-center justify-start gap-2 rounded px-2 py-1.5 text-gray-600 transition-colors">
          <PiMagnifyingGlass className="text-base" />
          <span>アシスタントを探す</span>
        </button>
      </div> */}

      {/* Chat History Section */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-3 py-2 text-xs font-semibold text-gray-600">
          チャット履歴
        </div>
        <div className="scrollbar-thin scrollbar-thumb-gray-300 flex-1 overflow-y-auto px-2">
          <ChatList searchWords={[]} />
        </div>
      </div>
    </nav>
  );
};

export default ChatSidebar;
