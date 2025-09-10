import React from 'react';
import { useParams } from 'react-router-dom';
import useBot from '../hooks/useBot';

const BotKbChatPage: React.FC = () => {
  const { botId } = useParams<{ botId: string }>();
  const { findBotById } = useBot();

  // TODO: Null系をどうにかする
  const { data: bot, isLoading } = findBotById(botId ?? '');

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return <div>{bot?.id}</div>;
};

export default BotKbChatPage;
