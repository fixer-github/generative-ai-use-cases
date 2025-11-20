import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ChatLocationState, PendingMessage } from '../@types/chat';

/**
 * URL遷移後に保存されたメッセージを自動送信するカスタムフック
 *
 * location.stateにpendingMessageが含まれている場合、
 * チャット状態の初期化完了後に自動的にメッセージを送信します。
 *
 * @param chatId - チャットID
 * @param loadingMessages - メッセージのロード中フラグ
 * @param onMessage - メッセージ送信時のコールバック関数
 */
export const usePendingMessageHandler = (
  chatId: string | undefined,
  loadingMessages: boolean,
  onMessage: (message: PendingMessage) => void
) => {
  const navigate = useNavigate();
  const { state } = useLocation() as { state: ChatLocationState | null };

  useEffect(() => {
    // チャット状態の初期化が完了してから実行
    if (chatId && state?.pendingMessage && !loadingMessages) {
      const pendingMessage = state.pendingMessage;

      // location.stateをクリアするため、replaceで同じURLに遷移
      navigate(`/chat/${chatId}`, { replace: true, state: null });

      // メッセージハンドラを呼び出す
      onMessage(pendingMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, state, loadingMessages]);
};
