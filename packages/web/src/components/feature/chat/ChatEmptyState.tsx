import React from 'react';
import { BaseProps } from '@/@types/common';

type Props = BaseProps & {
  icon?: React.ReactNode;
  message?: string;
};

const ChatEmptyState: React.FC<Props> = ({ icon, message, className }) => {
  return (
    <div
      className={`relative flex h-[calc(100vh-9rem)] flex-col items-center justify-center ${className ?? ''}`}>
      {icon}
      {message && <p className="mt-4 text-muted-foreground">{message}</p>}
    </div>
  );
};

export default ChatEmptyState;
