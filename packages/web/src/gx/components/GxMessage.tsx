/**
 * GxMessage — 新UIのメッセージ吹き出し。デザイン案（プロト ChatPage.jsx の
 * fs-msg / fs-bubble）に忠実な見た目を、新UI専用コンポーネントとして実装する。
 *
 * 移植規約ドラフト 7.3-1 の宿題への対応：現行 `ChatMessage` は旧GenUの見た目で
 * 旧UIからも使われるため共有改変はしない。本部品は `gx/` 内に独立して持ち、
 * レンダリングの中核（タイピング演出 useTyping / Markdown / 添付プレビュー）は
 * 現行の共有部品を**流用**する（作り直さない）。
 *
 * 与件：
 *   - D2：ファイルエクスプローラー（参照ファイルパネル）は含めない。ただし
 *     メッセージに添付された画像・ファイル・動画は会話の一部なので描画する。
 *   - デザイン案にはトークン数・生モデルID・フィードバック等のクロムが無いため、
 *     吹き出しは素のまま。補助操作（コピー / 再生成）はホバー時のみ最小表示。
 *     feedback / edit / システムプロンプト保存は本パスでは出さない（ドラフト §8 に記録）。
 */
import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ShownMessage } from 'generative-ai-use-cases';
import Markdown from '../../components/Markdown';
import ButtonCopy from '../../components/ButtonCopy';
import ZoomUpImage from '../../components/ZoomUpImage';
import ZoomUpVideo from '../../components/ZoomUpVideo';
import FileCard from '../../components/FileCard';
import useTyping from '../../hooks/useTyping';
import useFiles from '../../hooks/useFiles';
import { MODELS } from '../../hooks/useModel';
import { GX } from '../strings';
import { IcUser, IcRetry } from './icons';

type Props = {
  idx: number;
  chatContent?: ShownMessage;
  loading?: boolean;
  allowRetry?: boolean;
  retryGeneration?: () => void;
};

// createdDate（エポックms文字列）から HH:mm を作る。取れなければ空。
const formatTime = (createdDate?: string): string => {
  if (!createdDate) return '';
  const d = new Date(Number(createdDate));
  if (Number.isNaN(d.getTime())) return '';
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${hh}:${mm}`;
};

const GxMessage: React.FC<Props> = ({
  idx,
  chatContent,
  loading = false,
  allowRetry = false,
  retryGeneration,
}) => {
  const { pathname } = useLocation();
  const { getFileDownloadSignedUrl } = useFiles(pathname);

  const role = chatContent?.role ?? 'assistant';
  const isUser = role === 'user';
  const isAssistant = role === 'assistant';

  // ストリーミングのタイピング演出（assistant かつ loading のときのみアニメ）
  const { setTypingTextInput, typingTextOutput } = useTyping(
    isAssistant && loading
  );
  useEffect(() => {
    if (chatContent?.content !== undefined && chatContent?.content !== null) {
      setTypingTextInput(chatContent.content);
    }
  }, [chatContent, setTypingTextInput]);

  // 添付（画像/ファイル/動画）の署名付きURL解決。参照パネルとは別物。
  const [signedUrls, setSignedUrls] = useState<string[]>([]);
  useEffect(() => {
    if (chatContent?.extraData) {
      setSignedUrls(new Array(chatContent.extraData.length).fill(undefined));
      Promise.all(
        chatContent.extraData.map(async (file) =>
          file.source.type === 's3'
            ? await getFileDownloadSignedUrl(file.source.data, true)
            : file.source.data
        )
      ).then((results) => setSignedUrls(results));
    } else {
      setSignedUrls([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatContent]);

  const name = isUser ? GX.message.you : GX.message.aiName;
  const time = formatTime(chatContent?.createdDate);
  const modelChip =
    isAssistant && chatContent?.llmType
      ? MODELS.modelDisplayName(chatContent.llmType)
      : '';
  const streamingCursor =
    loading && (chatContent?.content ?? '') !== '' ? '▍' : '';
  const showEmptyPulse = loading && (chatContent?.content ?? '') === '';

  return (
    <div className="gx-msg">
      <div className={'gx-msg__ava ' + (isUser ? 'user' : 'ai')}>
        {isUser ? (
          <IcUser size={16} />
        ) : (
          <span className="gx-msg__ava-mark">G</span>
        )}
      </div>

      <div className="gx-msg__body">
        <div className="gx-msg__meta">
          <b>{name}</b>
          {modelChip && <span className="gx-msg__model">{modelChip}</span>}
          {time && <span className="gx-msg__time">{time}</span>}
        </div>

        {chatContent?.extraData && chatContent.extraData.length > 0 && (
          <div className="gx-msg__files">
            {chatContent.extraData.map((data, i) => {
              if (data.type === 'image') {
                return (
                  <ZoomUpImage
                    key={i}
                    src={signedUrls[i]}
                    size="m"
                    loading={!signedUrls[i]}
                  />
                );
              } else if (data.type === 'video') {
                return <ZoomUpVideo key={i} src={signedUrls[i]} size="m" />;
              } else if (data.type === 'file') {
                return (
                  <FileCard
                    key={i}
                    filename={data.name}
                    url={signedUrls[i]}
                    loading={!signedUrls[i]}
                    size="m"
                  />
                );
              }
              return null;
            })}
          </div>
        )}

        <div className={'gx-msg__bubble ' + (isUser ? 'user' : 'ai')}>
          {isAssistant ? (
            showEmptyPulse ? (
              /* eslint-disable-next-line @shopify/jsx-no-hardcoded-content */
              <span className="gx-msg__pulse">▍</span>
            ) : (
              <Markdown prefix={`${idx}`}>
                {typingTextOutput + streamingCursor}
              </Markdown>
            )
          ) : (
            <div className="gx-msg__plain">{typingTextOutput}</div>
          )}
        </div>

        {isAssistant && !loading && chatContent && (
          <div className="gx-msg__actions">
            {allowRetry && retryGeneration && (
              <button
                type="button"
                className="gx-msg__action"
                title={GX.message.retry}
                aria-label={GX.message.retry}
                onClick={() => retryGeneration()}>
                <IcRetry size={15} />
              </button>
            )}
            <ButtonCopy
              className="gx-msg__action"
              text={chatContent.content || ''}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default GxMessage;
