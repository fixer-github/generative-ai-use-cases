import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
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
  const { state } = useLocation() as { state: ChatLocationState | null };
  const pendingMessageRef = useRef<PendingMessage | null>(null);
  const processedRef = useRef(false);
  const onMessageRef = useRef(onMessage);

  // onMessageの最新の参照を保持
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // location.stateからpendingMessageを取得して保存
  useEffect(() => {
    if (chatId && state?.pendingMessage && !processedRef.current) {
      // useRefに保存（stateクリア後も参照可能にする）
      pendingMessageRef.current = state.pendingMessage;

      // window.history.replaceStateでstateをクリア（画面遷移なし）
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [chatId, state]);

  // メッセージ送信の副作用
  useEffect(() => {
    if (chatId && pendingMessageRef.current && !processedRef.current) {
      // loadingMessagesが完了するのを待つ、または最大1秒後に強制実行
      const sendMessage = () => {
        if (!processedRef.current && pendingMessageRef.current) {
          processedRef.current = true;
          const pendingMessage = pendingMessageRef.current;
          onMessageRef.current(pendingMessage);
          pendingMessageRef.current = null;
        }
      };

      if (!loadingMessages) {
        // loadingが完了している場合は200ms後に実行
        const timer = setTimeout(sendMessage, 200);
        return () => clearTimeout(timer);
      } else {
        // loadingが完了していない場合は最大1秒待つ
        const timer = setTimeout(sendMessage, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [chatId, loadingMessages]);

  // chatIdが変わったら処理済みフラグをリセット（pendingMessageがない場合のみ）
  useEffect(() => {
    // location.stateにpendingMessageがない場合のみリセット
    // （別のチャットへの移動時）
    if (!state?.pendingMessage) {
      processedRef.current = false;
      pendingMessageRef.current = null;
    }
  }, [chatId, state]);
};
