/**
 * GxChatPage — 新UIのチャット画面（Phase 1 第1号・リファレンス実装）。
 *
 * 移植規約ドラフトの仕分けに従う：
 *   - (b) 再スキン型：会話本体（ストリーミング・吹き出し・retry/edit・添付プレビュー）は
 *     現行 useChat / ChatMessage をそのまま流用する（作り直さない）。
 *   - (a) 新規UI型：コンポーザ（GxComposer）とアプリバー（GxAppBar）は新規。
 *
 * 与件（判断メモ D2/D4）：
 *   - D4：モデル選択UIは出さない。モデルは内部で既定値に固定し、表示はブランド名のみ。
 *   - D2：ファイルパネル本体は出さない。ただしレイアウトはパネル出現を見込んで組む
 *     （.gx-chat は position:absolute inset:0 で、後から右に絶対配置パネルを足せる）。
 *     添付アップロード自体は現行どおり動かす。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  AdditionalModelRequestFields,
  FileLimit,
} from 'generative-ai-use-cases';
import useChat from '../../hooks/useChat';
import useChatList from '../../hooks/useChatList';
import useFiles from '../../hooks/useFiles';
import { useAgentCore } from '../../hooks/useAgentCore';
import { MODELS } from '../../hooks/useModel';
import { getPrompter } from '../../prompts';
import { AcceptedDotExtensions } from '../../utils/MediaUtils';
import GxAppBar from '../components/GxAppBar';
import GxComposer from '../components/GxComposer';
import GxMessage from '../components/GxMessage';
import { IcFiles } from '../components/icons';
import { GX } from '../strings';
import { GxChatStartContext } from '../types';
import '../styles/chat.css';

const fileLimit: FileLimit = {
  accept: AcceptedDotExtensions,
  maxFileCount: 5,
  maxFileSizeMB: 4.5,
  maxImageFileCount: 20,
  maxImageFileSizeMB: 3.75,
  maxVideoFileCount: 1,
  maxVideoFileSizeMB: 1000,
};

const DEFAULT_REASONING_BUDGET = 4096;

const GxChatPage: React.FC = () => {
  const { pathname, state } = useLocation();
  const { chatId } = useParams();

  // 開始コンテキスト（型は gx/types.ts。統一メモ §3）。
  // location.state に乗ってくる。エージェント一覧/トップからの遷移で渡される。
  const startContext = (state as GxChatStartContext | null) ?? undefined;
  const target = startContext?.target;
  const isAgentCore = target?.kind === 'agentcore';

  const {
    clear: clearFiles,
    uploadedFiles,
    uploadFiles,
    base64Cache,
  } = useFiles(pathname);

  const {
    getModelId,
    setModelId,
    loading,
    writing,
    loadingMessages,
    isEmpty,
    messages,
    postChat,
    retryGeneration,
    updateSystemContextByModel,
    forceToStop,
  } = useChat(pathname, chatId);
  // 公式（AgentCore）実行は同じ pathname の useChat ストアを共有したまま、
  // 送信トランスポートだけを差し替える（統一メモ §1・§4）。
  const { invokeAgentRuntime } = useAgentCore(pathname);
  const { getChatTitle } = useChatList();
  const { allModelIds: availableModels } = MODELS;

  // 開始コンテキストの content を初期値に（D5：シーン流し込み）。
  const [content, setContent] = useState(() => startContext?.content ?? '');
  const [isOver, setIsOver] = useState(false);
  // AgentCore 実行は会話単位の sessionId（uuid）を要求（統一メモ §5-1）。
  const sessionId = useRef(uuidv4());
  const threadRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const modelId = getModelId();
  const prompter = useMemo(() => getPrompter(modelId), [modelId]);

  // D4：モデル選択UIを出さないため、未設定なら既定モデルへ内部固定する
  useEffect(() => {
    if (!modelId && availableModels.length > 0) {
      setModelId(availableModels[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, availableModels]);

  // 新規会話のときはモデルに対応したシステムプロンプトを反映（既存挙動の踏襲）。
  // AgentCore 実行はランタイム側に固有のプロンプトがあるため注入しない
  // （現行 AgentCorePage の挙動に合わせる。統一メモ §1）。
  useEffect(() => {
    if (!chatId && !isAgentCore) {
      updateSystemContextByModel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompter, isAgentCore]);

  const accept = useMemo(() => {
    if (!modelId) return [] as string[];
    const feature = MODELS.getModelMetadata(modelId);
    return [
      ...(feature.flags.doc ? fileLimit.accept.doc : []),
      ...(feature.flags.image ? fileLimit.accept.image : []),
      ...(feature.flags.video ? fileLimit.accept.video : []),
    ];
  }, [modelId]);
  const fileUpload = accept.length > 0;

  const overrideModelParameters: AdditionalModelRequestFields = useMemo(
    () => ({
      reasoningConfig: {
        type: 'disabled',
        budgetTokens: DEFAULT_REASONING_BUDGET,
      },
    }),
    []
  );

  const title = useMemo(() => {
    if (chatId) return getChatTitle(chatId) || GX.chat.newTitle;
    return GX.chat.newTitle;
  }, [chatId, getChatTitle]);

  const onSend = useCallback(() => {
    stickToBottom.current = true;

    // 送信トランスポートを target で分岐（統一メモ §4）。
    // 会話ストア・履歴永続化・描画・添付は両経路で共有される。
    if (isAgentCore && target?.kind === 'agentcore') {
      // AgentCore（ARN 実行）。プロンプトは prompter で包まず素の content を渡す
      // （現行 AgentCorePage と同じ）。添付は File[] に正規化する（統一メモ §5）。
      const filesToSend = fileUpload
        ? uploadedFiles
            .filter((f) => !f.errorMessages.length && !f.uploading)
            .map((f) => f.file)
        : undefined;
      invokeAgentRuntime(
        target.arn,
        sessionId.current,
        content,
        'DEFAULT',
        filesToSend && filesToSend.length > 0 ? filesToSend : undefined
      );
    } else {
      postChat(
        prompter.chatPrompt({ content }),
        false,
        undefined,
        undefined,
        undefined,
        fileUpload ? uploadedFiles : undefined,
        undefined,
        undefined,
        undefined,
        base64Cache,
        overrideModelParameters,
        false
      );
    }
    setContent('');
    clearFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    content,
    prompter,
    fileUpload,
    uploadedFiles,
    base64Cache,
    overrideModelParameters,
    isAgentCore,
    target,
    invokeAgentRuntime,
  ]);

  const onStop = useCallback(() => {
    forceToStop();
  }, [forceToStop]);

  const onRetry = useCallback(() => {
    stickToBottom.current = true;
    retryGeneration(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      base64Cache,
      overrideModelParameters,
      false
    );
  }, [retryGeneration, base64Cache, overrideModelParameters]);

  // 内部スクロール追従：末尾付近にいるときだけ自動で最下部へ
  const onThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);
  useEffect(() => {
    const el = threadRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, loading]);

  // 添付ファイルのドラッグ&ドロップ（現行 ChatPage と同等）
  const onDragOver = (e: React.DragEvent) => {
    if (!fileUpload) return;
    e.preventDefault();
    setIsOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    if (e.dataTransfer.files) {
      uploadFiles(Array.from(e.dataTransfer.files), fileLimit, accept);
    }
  };

  const showEmpty = isEmpty && !loadingMessages && !chatId;

  const composer = (
    <GxComposer
      variant={showEmpty ? 'hero' : 'inline'}
      content={content}
      onChangeContent={setContent}
      onSend={onSend}
      onStop={onStop}
      canStop={writing}
      disabled={loading && !writing}
      autoFocus={showEmpty}
      fileUpload={fileUpload}
      accept={accept}
      fileLimit={fileLimit}
    />
  );

  return (
    <div
      className="gx-chat"
      onDragOver={fileUpload ? onDragOver : undefined}
      onDragLeave={isOver ? onDragLeave : undefined}
      onDrop={isOver ? onDrop : undefined}>
      <GxAppBar root={GX.chat.crumbRoot} current={title}>
        <div className="gx-appbar__model">
          <span className="gx-appbar__model-dot" />
          {GX.chat.modelLabel}
        </div>
        {/* D2：ファイルパネル本体は Phase 1 では未実装。導線は予約のみ（無効表示）。 */}
        <button
          type="button"
          className="gx-appbar__btn"
          disabled
          title="ファイルパネルは今後のフェーズで提供します">
          <IcFiles size={16} />
          {GX.chat.filesButton}
        </button>
      </GxAppBar>

      {loadingMessages ? (
        <div className="gx-chat__loading">
          <div className="gx-chat__spinner" />
          {GX.chat.loadingMessages}
        </div>
      ) : showEmpty ? (
        <div className="gx-chat__empty">
          <div className="gx-chat__empty-title">{GX.chat.emptyTitle}</div>
          <div className="gx-chat__empty-sub">{GX.chat.emptySub}</div>
          {composer}
        </div>
      ) : (
        <>
          <div
            className="gx-chat__thread"
            ref={threadRef}
            onScroll={onThreadScroll}>
            <div className="gx-chat__thread-inner">
              {messages.map((chat, idx) => (
                <GxMessage
                  key={idx}
                  idx={idx}
                  chatContent={chat}
                  loading={loading && idx === messages.length - 1}
                  allowRetry={idx === messages.length - 1}
                  retryGeneration={onRetry}
                />
              ))}
            </div>
          </div>
          {composer}
        </>
      )}

      {isOver && fileUpload && (
        <div className="gx-chat__dropmask">
          <div className="gx-chat__dropmask-inner">
            ファイルをドロップして添付
          </div>
        </div>
      )}
    </div>
  );
};

export default GxChatPage;
