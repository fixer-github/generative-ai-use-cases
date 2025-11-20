import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PendingMessage } from '../@types/chat';
import {
  extractPlainChatId,
  createChatNavigationState,
} from '../utils/ChatUtils';

/**
 * 新規チャット作成時のナビゲーション処理を担当するカスタムフック
 *
 * @returns createAndNavigate - チャット作成とURL遷移を行う関数
 */
export const useNewChatNavigation = () => {
  const navigate = useNavigate();

  /**
   * 新規チャットを作成してURL遷移する
   *
   * @param createChatIfNotExist - チャット作成関数
   * @param messageData - メッセージデータ（modelIdを除く）
   * @param modelId - モデルID
   */
  const createAndNavigate = useCallback(
    async (
      createChatIfNotExist: () => Promise<string>,
      messageData: Omit<PendingMessage, 'modelId'>,
      modelId: string
    ) => {
      // チャット作成
      const newChatId = await createChatIfNotExist();
      const plainChatId = extractPlainChatId(newChatId);

      // ナビゲーション用のstateを作成
      const navigationState = createChatNavigationState(messageData, modelId);

      // URL遷移（メッセージ内容をstateで渡す）
      navigate(`/chat/${plainChatId}`, {
        replace: true,
        state: navigationState,
      });
    },
    [navigate]
  );

  return { createAndNavigate };
};
