/**
 * GxComposer — 新UIの統合コンポーザ（最優先共有部品 / 移植規約ドラフト 3.2(1)）。
 *
 * D5：トップのシーン選択→チャット開始は「同じコンポーザの別状態」。そのため
 * variant で出し分ける 1 部品にする。本 increment ではチャットの inline を
 * リファレンス実装として確定し、hero（トップ）はトップ着工時にこの部品を再利用する。
 *
 *   - inline : 会話下部に常駐する標準コンポーザ
 *   - hero   : トップ・空状態向けの大型（グラデCTA）
 *
 * 添付は現行 useFiles に結線（D2：参照ファイルパネル本体は Phase 1 では出さない。
 * 添付アップロード自体は現行どおり動かす）。送信/停止・本文の状態は親が保持する。
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { FileLimit } from 'generative-ai-use-cases';
import useFiles from '../../hooks/useFiles';
import useMicrophone from '../../hooks/useMicrophone';
import { GX } from '../strings';
import { IcPaperclip, IcMic, IcSend, IcStop, IcClose } from './icons';

type Props = {
  variant?: 'inline' | 'hero';
  content: string;
  onChangeContent: (content: string) => void;
  onSend: () => void;
  onStop?: () => void;
  /** 生成中で停止可能（送信ボタンを停止ボタンに切り替える） */
  canStop?: boolean;
  /** 応答待ちなどで入力・送信を抑止する */
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** 添付（現行 useFiles 結線）。false の場合は添付ボタンを出さない */
  fileUpload?: boolean;
  accept?: string[];
  fileLimit?: FileLimit;
  /**
   * 添付ファイルの保存スコープ（useFiles のキー）。既定は現在の pathname。
   * トップ（/g）は遷移先チャット（/g/chat）のスコープを指定することで、
   * トップで添付したファイルを新規チャットへ引き継ぐ（メモ §3）。
   */
  fileScope?: string;
  /** 音声入力（既存 Amazon Transcribe / useMicrophone）。false で非表示（メモ §3） */
  mic?: boolean;
};

const GxComposer: React.FC<Props> = ({
  variant = 'inline',
  content,
  onChangeContent,
  onSend,
  onStop,
  canStop = false,
  disabled = false,
  placeholder,
  autoFocus = false,
  fileUpload = false,
  accept,
  fileLimit,
  fileScope,
  mic = false,
}) => {
  const { pathname } = useLocation();
  const fileKey = fileScope ?? pathname;
  const {
    uploadedFiles,
    uploadFiles,
    deleteUploadedFile,
    checkFiles,
    errorMessages,
  } = useFiles(fileKey);

  // 音声入力（Transcribe）。録音開始時点の本文を base として保持し、
  // 文字起こし結果を base の後ろに追記する（既存 TranslatePage と同じ流儀）。
  const {
    startTranscription,
    stopTranscription,
    recording,
    transcriptMic,
    clearTranscripts,
  } = useMicrophone();
  const micBaseRef = useRef('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 録音中、文字起こしが更新されるたびに本文へ反映する。
  useEffect(() => {
    if (!recording) return;
    const text = transcriptMic.map((item) => item.transcript).join('\n');
    if (text.length === 0) return;
    const base = micBaseRef.current;
    onChangeContent(base ? `${base}\n${text}` : text);
    // onChangeContent は親の setState。依存に入れると毎回張り直すため除外。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptMic, recording]);

  const handleMicToggle = useCallback(() => {
    if (recording) {
      stopTranscription();
    } else {
      micBaseRef.current = content;
      clearTranscripts();
      startTranscription();
    }
  }, [recording, content, stopTranscription, clearTranscripts, startTranscription]);

  // モデル変更などで添付制約が変わったら検証する（現行 InputChatContent と同挙動）
  useEffect(() => {
    if (fileLimit && accept) {
      checkFiles(fileLimit, accept);
    }
  }, [checkFiles, fileLimit, accept]);

  // 本文に追従して textarea の高さを自動調整
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [content]);

  const canSend = !disabled && content.trim().length > 0;

  const handleSendClick = useCallback(() => {
    if (canStop) {
      onStop?.();
    } else if (canSend) {
      onSend();
    }
  }, [canStop, canSend, onStop, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter で送信 / Shift+Enter で改行（IME 変換確定の Enter は送信しない）
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (!canStop && canSend) onSend();
      }
    },
    [canStop, canSend, onSend]
  );

  const onPickFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && fileLimit && accept) {
        uploadFiles(Array.from(files), fileLimit, accept);
      }
      e.target.value = '';
    },
    [uploadFiles, fileLimit, accept]
  );

  const isHero = variant === 'hero';
  const resolvedPlaceholder =
    placeholder ??
    (isHero ? GX.composer.placeholderHero : GX.composer.placeholderInline);

  // ツール行（音声入力・文書添付）。hero（トップ）はラベル付きピル、inline（チャット）は
  // アイコンのみ。プロト：hero=optB-tool（ラベル付き）/ inline=fs-ctool（アイコン）。
  const tools = (fileUpload || mic) && (
    <div className="gx-composer__tools">
      {mic && (
        <button
          type="button"
          className={
            'gx-composer__tool' +
            (recording ? ' gx-composer__tool--recording' : '')
          }
          title={recording ? GX.composer.micStop : GX.composer.micStart}
          aria-label={recording ? GX.composer.micStop : GX.composer.micStart}
          aria-pressed={recording}
          disabled={disabled && !recording}
          onClick={handleMicToggle}>
          <IcMic size={isHero ? 14 : 18} />
          {isHero && (
            <span className="gx-composer__tool-label">
              {GX.composer.toolMicLabel}
            </span>
          )}
        </button>
      )}
      {fileUpload && (
        <>
          <button
            type="button"
            className="gx-composer__tool"
            title={GX.composer.attach}
            aria-label={GX.composer.attach}
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}>
            <IcPaperclip size={isHero ? 14 : 18} />
            {isHero && (
              <span className="gx-composer__tool-label">
                {GX.composer.toolAttachLabel}
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={accept?.join(',')}
            onChange={onPickFiles}
          />
        </>
      )}
    </div>
  );

  const textarea = (
    <textarea
      ref={textareaRef}
      className="gx-composer__input"
      rows={1}
      value={content}
      placeholder={resolvedPlaceholder}
      disabled={disabled && !canStop}
      autoFocus={autoFocus}
      onChange={(e) => onChangeContent(e.target.value)}
      onKeyDown={handleKeyDown}
    />
  );

  const sendButton = (
    <button
      type="button"
      className={
        'gx-composer__send' + (canStop ? ' gx-composer__send--stop' : '')
      }
      disabled={!canStop && !canSend}
      title={canStop ? GX.composer.stop : GX.composer.send}
      aria-label={canStop ? GX.composer.stop : GX.composer.send}
      onClick={handleSendClick}>
      {canStop ? (
        <IcStop size={14} />
      ) : isHero ? (
        <>
          {GX.composer.startGenerate}
          <IcSend size={14} />
        </>
      ) : (
        <IcSend size={17} />
      )}
    </button>
  );

  return (
    <div className="gx-composer-wrap">
      {errorMessages.length > 0 && (
        <div className="gx-composer__error" role="alert">
          {errorMessages.join(' / ')}
        </div>
      )}

      {fileUpload && uploadedFiles.length > 0 && (
        <div
          className={
            'gx-composer__files' + (isHero ? ' gx-composer__files--hero' : '')
          }>
          {uploadedFiles.map((f) => (
            <span key={f.id} className="gx-composer__file" title={f.name}>
              <span className="gx-composer__file-name">{f.name}</span>
              <button
                type="button"
                className="gx-composer__file-x"
                aria-label={`${f.name} を削除`}
                onClick={() =>
                  fileLimit &&
                  accept &&
                  deleteUploadedFile(f.id, fileLimit, accept)
                }>
                <IcClose size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={'gx-composer' + (isHero ? ' gx-composer--hero' : '')}>
        {isHero ? (
          // hero（トップ）：プロト optB-composer の縦2段レイアウト。
          // 上＝テキスト入力、下＝[ツール行 ／ 送信] の actions 行。
          <>
            {textarea}
            <div className="gx-composer__actions">
              {tools}
              {sendButton}
            </div>
          </>
        ) : (
          // inline（チャット）：プロト fs-composer の横1段（ツール｜入力｜送信）。
          <>
            {tools}
            {textarea}
            {sendButton}
          </>
        )}
      </div>
    </div>
  );
};

export default GxComposer;
