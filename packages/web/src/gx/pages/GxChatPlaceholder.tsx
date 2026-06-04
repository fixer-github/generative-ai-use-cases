/**
 * チャット画面のプレースホルダ（Phase 0）。
 * サイドバーの履歴クリックで /g/chat/:chatId に遷移し、chatId が渡ることを確認する。
 * 実際のチャット移植は Phase 1。
 */
import React from 'react';
import { useParams } from 'react-router-dom';
import GxPlaceholderPage from './GxPlaceholderPage';
import { GX } from '../strings';

const GxChatPlaceholder: React.FC = () => {
  const { chatId } = useParams();
  return (
    <GxPlaceholderPage
      title={chatId ? `${GX.pages.chat}（${chatId}）` : GX.pages.chat}
    />
  );
};

export default GxChatPlaceholder;
