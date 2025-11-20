import { CHAT_ID_PREFIX } from '../constants/chat';
import type { PendingMessage, ChatLocationState } from '../@types/chat';

/**
 * Extract the xxxx part from usecase#xxxx format
 * @param _usecaseId usecase#xxxx format usecaseId
 * @returns null if it is not usecase#xxxx format
 */
export const decomposeId = (_usecaseId: string): string | null => {
  if (!_usecaseId.includes('#')) {
    return null;
  }
  return _usecaseId.split('#')[1];
};

/**
 * チャットIDからプレフィックスを除去してプレーンなIDを取得
 * @param chatId chat#<uuid> 形式のチャットID
 * @returns プレーンなUUID
 * @example
 * extractPlainChatId('chat#123-456-789') // => '123-456-789'
 */
export const extractPlainChatId = (chatId: string): string => {
  return chatId.replace(CHAT_ID_PREFIX, '');
};

/**
 * チャットナビゲーション用のlocation.stateを作成
 * @param messageData メッセージデータ（modelIdを除く）
 * @param modelId モデルID
 * @returns ChatLocationState オブジェクト
 */
export const createChatNavigationState = (
  messageData: Omit<PendingMessage, 'modelId'>,
  modelId: string
): ChatLocationState => ({
  pendingMessage: {
    ...messageData,
    modelId,
  },
});
