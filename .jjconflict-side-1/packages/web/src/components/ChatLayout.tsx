import React from 'react';
import { Outlet } from 'react-router-dom';
import ChatSidebar from './ChatSidebar';

type Props = {
  children?: React.ReactNode; // If provided, renders children instead of Outlet
};

/**
 * ChatLayout - Common layout for chat-related pages
 * Provides ChatSidebar on the left and renders child routes via Outlet or children
 */
const ChatLayout: React.FC<Props> = ({ children }) => {
  return (
    <>
      {/* Chat Sidebar */}
      <div className="fixed left-24 top-0 z-40 h-screen print:hidden">
        <ChatSidebar />
      </div>

      {/* Main Content Area */}
      <div className="ml-64 min-h-screen">
        {/* Page Content - either children or Outlet for routes */}
        {children || <Outlet />}
      </div>
    </>
  );
};

export default ChatLayout;
