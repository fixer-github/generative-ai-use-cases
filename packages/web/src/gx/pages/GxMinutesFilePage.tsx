/**
 * GxMinutesFilePage — 議事録ワークベンチ「ファイルから文字起こし」（Phase 2 / step 3c）。
 *
 * 着工方針：`Phase2_議事録ワークベンチ_着工方針メモ.md` §2.1・§5 step3・§9.4。
 * デザインバンドル project/app/MEntry.jsx の MEntryFile（セットアップ）＋ MUploadProc
 * （バックグラウンド処理中）を1ページの2フェーズへ移植。
 *
 * 仕分け（移植規約 1.3）：
 *   - (b) 再スキン型：バッチ文字起こしは現行 `useTranscribe`（署名URLアップロード →
 *     Transcribe ジョブ開始 → 2秒ポーリング・withRetry 3回／指数バックオフ・FAILED は
 *     toast＝§4.1 のエラーハンドリングをそのまま継承）を流用。
 *   - (a) 新規UI型：ドロップゾーン・話者分離スイッチ・想定人数ステッパ・処理中表示は新規。
 *
 * B3 採用（共通基盤クラスタ step 4-f）：
 *   - 開始時に createMeeting({source:'batch'}) で会議を先に作成（status=transcribing）。
 *     これにより会議が即サイドバーに出て、離脱しても B3（EventBridge 完了検知）が
 *     status を ready/failed へ進める（固まらない・完了通知が出る）。
 *   - meetingId を transcribe へ渡してジョブ名に埋め込む（B3 が job→meeting を逆引き）。
 *     得た jobName は会議に保存（離脱後に再開した時のワークベンチ fetch-on-open 用）。
 *   - 完了まで滞在した場合は従来どおり編集ワークベンチへ遷移するが、createMeeting 済みの
 *     meetingId を location.state で渡し、ワークベンチは二重作成せず再利用する。
 *   - backend 未デプロイ／createMeeting 失敗時は meetingId 無しで従来の inline 経路に
 *     フォールバック（壊れた会議行を作らない）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useTranscribe from '../../hooks/useTranscribe';
import useMeetingApi from '../../hooks/useMeetingApi';
import {
  IcBack,
  IcUpload,
  IcFileAudio,
  IcCheck,
  IcInfo,
  IcTranscribe,
  IcRefresh,
  IcFiles,
  IcSpark,
} from '../components/icons';
import { GX } from '../strings';
import '../styles/minutes-shared.css';
import '../styles/minutes-entry.css';

const F = GX.minutes.file;

const ACCEPT = '.mp3,.wav,.m4a,.mp4,.flac,.ogg,.webm,audio/*,video/*';

const stripMeetingPrefix = (id: string) => id.replace(/^meeting#/, '');
// Derive a default meeting title from the file name (drop the extension).
const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, '') || name;

const fmtBytes = (n: number): string => {
  if (n >= 1024 * 1024 * 1024)
    return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
};

const fmtDuration = (totalSec: number): string => {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}時間${m % 60}分`;
  }
  return `${m}分${String(sec).padStart(2, '0')}秒`;
};

const GxMinutesFilePage: React.FC = () => {
  const navigate = useNavigate();
  const { loading, transcriptData, file, setFile, transcribe, clear, jobName } =
    useTranscribe();
  const meetingApi = useMeetingApi();

  // 開始時に作成した会議の bare id（B3 結線・遷移時の再利用に使う）。
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const jobNameSavedRef = useRef(false);

  const [phase, setPhase] = useState<'setup' | 'processing'>('setup');
  const [dragOver, setDragOver] = useState(false);
  const [speakerLabel, setSpeakerLabel] = useState(true);
  const [maxSpeakers, setMaxSpeakers] = useState(4);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ページ離脱時は zustand のジョブ状態をクリア（再入時に前回ジョブを引きずらない）。
  useEffect(() => () => clear(), [clear]);

  // 選択ファイルの再生時間をメタデータから推定（任意・取れなければ表示を省く）。
  const probeDuration = useCallback((f: File) => {
    setDurationSec(null);
    const url = URL.createObjectURL(f);
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      if (isFinite(el.duration)) setDurationSec(el.duration);
      URL.revokeObjectURL(url);
    };
    el.onerror = () => URL.revokeObjectURL(url);
    el.src = url;
  }, []);

  const onPick = useCallback(
    (f: File | undefined) => {
      if (!f) return;
      setFile(f);
      probeDuration(f);
    },
    [setFile, probeDuration]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      onPick(e.dataTransfer.files?.[0]);
    },
    [onPick]
  );

  const onStart = useCallback(async () => {
    if (!file) return;
    setPhase('processing');
    // B3: 会議を先に作成（status=transcribing）。失敗しても文字起こしは継続し、
    // meetingId 無し＝従来の inline 経路にフォールバックする（壊れた行を作らない）。
    let mid: string | undefined;
    try {
      const res = await meetingApi.createMeeting({
        source: 'batch',
        title: titleFromFile(file.name),
      });
      mid = stripMeetingPrefix(res.meeting.meetingId);
      setMeetingId(mid);
    } catch (e) {
      console.log('createMeeting (batch) failed', e);
    }
    // withRetry / FAILED トースト等のエラーハンドリングは useTranscribe が担保（§4.1）。
    transcribe(speakerLabel, speakerLabel ? maxSpeakers : 1, 'ja-JP', mid);
  }, [file, transcribe, speakerLabel, maxSpeakers, meetingApi]);

  // ジョブ開始で得た jobName を会議に保存（1度だけ）。離脱後に再開した時、ワークベンチが
  // この jobName で getTranscription を取りに行く（fetch-on-open）。
  useEffect(() => {
    if (!jobName || !meetingId || jobNameSavedRef.current) return;
    jobNameSavedRef.current = true;
    meetingApi
      .updateMeeting(meetingId, { jobName })
      .catch((e) => console.log('updateMeeting jobName failed', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobName, meetingId]);

  // 文字起こし完了（transcriptData 到着）で編集ワークベンチへ。
  useEffect(() => {
    if (phase !== 'processing') return;
    if (transcriptData?.transcripts) {
      navigate('/g/minutes/draft', {
        state: {
          // 開始時に作成済みの会議を再利用させる（ワークベンチは二重 createMeeting しない）。
          meetingId: meetingId ?? undefined,
          fileDraft: {
            source: 'batch',
            fileName: file?.name ?? '',
            sizeLabel: file ? fmtBytes(file.size) : '',
            durationLabel: durationSec != null ? fmtDuration(durationSec) : '',
            speakerLabel,
            maxSpeakers,
            transcripts: transcriptData.transcripts,
            languageCode: transcriptData.languageCode,
          },
        },
      });
    }
  }, [
    phase,
    transcriptData,
    navigate,
    file,
    durationSec,
    speakerLabel,
    maxSpeakers,
    meetingId,
  ]);

  const onBack = useCallback(() => navigate('/g/minutes'), [navigate]);

  const sizeLabel = file ? fmtBytes(file.size) : '';
  const durationLabel = durationSec != null ? fmtDuration(durationSec) : '';
  const fileMeta = [sizeLabel, durationLabel].filter(Boolean).join(' ・ ');

  return (
    <div className="gx-me2">
      <header className="gx-me2__top">
        <button className="gx-me2__back" title={F.backTitle} onClick={onBack}>
          <IcBack />
        </button>
        <div>
          <div className="gx-me2__ttl">{F.title}</div>
          <div className="gx-me2__meta">
            <span>{GX.minutes.record.crumbRoot}</span>
            <span style={{ color: 'var(--fg-4)' }}>›</span>
            <span>
              {phase === 'processing' ? F.crumbProcessing : F.crumbSetup}
            </span>
          </div>
        </div>
        <div className="gx-me2__sp" />
        {phase === 'processing' ? (
          <span className="gx-me2__status processing">
            <span className="dot" />
            {F.statusProcessing}
          </span>
        ) : (
          <span className="gx-me2__status">
            <span className="dot" />
            {F.statusNew}
          </span>
        )}
      </header>

      <div className="gx-me2__scroll">
        <div className="gx-me2__wrap">
          {phase === 'setup' ? (
            <>
              {/* ドロップゾーン（クリックでファイル選択） */}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                style={{ display: 'none' }}
                onChange={(e) => onPick(e.target.files?.[0])}
              />
              <button
                type="button"
                className={'gx-me2__dz' + (dragOver ? ' drag' : '')}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}>
                <div className="ic">
                  <IcUpload size={22} />
                </div>
                <div>
                  <h3>
                    {F.dropTitle}
                    <u>{F.dropTitleEmphasis}</u>
                  </h3>
                  <p>{F.dropSub}</p>
                </div>
                <div className="gx-me2__fmts">
                  <span className="gx-me2__fmt">MP3</span>
                  <span className="gx-me2__fmt">WAV</span>
                  <span className="gx-me2__fmt">M4A</span>
                  <span className="gx-me2__fmt">MP4</span>
                </div>
              </button>

              {/* セットアップ（選択済みファイル ＋ 話者分離設定） */}
              <div className="gx-me2__card gx-me2__setup">
                <div>
                  <div className="gx-me2__lab">
                    {F.uploadedLabel}
                    <span className="opt">{file ? '1件' : '0件'}</span>
                  </div>
                  {file ? (
                    <div className="gx-me2__file">
                      <div className="fi">
                        <IcFileAudio size={18} />
                      </div>
                      <div>
                        <div className="nm">{file.name}</div>
                        <div className="mt">{fileMeta || sizeLabel}</div>
                      </div>
                      <span className="ok">
                        <IcCheck size={14} />
                        {F.uploadedDone}
                      </span>
                    </div>
                  ) : (
                    <div className="gx-me2__desc">{F.noFile}</div>
                  )}
                </div>
                <div className="gx-me2__vline" />
                <div>
                  <div className="gx-me2__sphead">
                    <div>
                      <div className="gx-me2__lab" style={{ marginBottom: 2 }}>
                        {F.speakerLabelTitle}
                      </div>
                      <div className="gx-me2__desc">{F.speakerLabelDesc}</div>
                    </div>
                    <button
                      className={'gx-me2__switch' + (speakerLabel ? ' on' : '')}
                      onClick={() => setSpeakerLabel((v) => !v)}
                      aria-label={F.speakerLabelTitle}
                    />
                  </div>
                  {speakerLabel && (
                    <div className="gx-me2__count">
                      <span>{F.speakerCount}</span>
                      <div className="gx-me2__step">
                        <button
                          onClick={() =>
                            setMaxSpeakers((n) => Math.max(2, n - 1))
                          }
                          disabled={maxSpeakers <= 2}>
                          −
                        </button>
                        <span className="val">{maxSpeakers}</span>
                        <button
                          onClick={() =>
                            setMaxSpeakers((n) => Math.min(10, n + 1))
                          }
                          disabled={maxSpeakers >= 10}>
                          ＋
                        </button>
                      </div>
                      <span className="gx-me2__desc" style={{ margin: 0 }}>
                        {F.speakerCountHint}
                      </span>
                    </div>
                  )}
                  <div className="gx-me2__note">
                    <IcInfo />
                    <span>
                      {F.detectLead}
                      <b>{F.detectBold}</b>
                      {F.detectTail}
                    </span>
                  </div>
                </div>
              </div>

              {/* アクションバー（開始） */}
              <div className="gx-me2__card gx-me2__actionbar">
                <div className="ic">
                  <IcSpark size={20} />
                </div>
                <div>
                  <div className="lbl">{file ? F.actionReady : F.title}</div>
                  <div className="mt">
                    {file ? fileMeta || file.name : F.noFile}
                  </div>
                </div>
                <div className="gx-me2__sp" />
                <span className="est">{F.estPrefix}</span>
                <button
                  className="gx-me2__primary"
                  onClick={onStart}
                  disabled={!file || loading}>
                  <IcTranscribe size={16} />
                  {F.actionStart}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* バックグラウンド実行バナー */}
              <div className="gx-me2__bg">
                <div className="ic">
                  <IcRefresh size={19} />
                </div>
                <div>
                  <b>{F.bgRunningTitle}</b>
                  <p>{F.bgRunningDesc}</p>
                </div>
                <div className="gx-me2__sp" />
                <button
                  className="gx-me2__ghost"
                  onClick={() => navigate('/g/minutes')}>
                  <IcFiles size={14} />
                  {F.historyButton}
                </button>
              </div>

              {/* 処理中カード */}
              <div className="gx-me2__card gx-me2__proc">
                <div className="gx-me2__ring" />
                <h3>{F.processingTitle}</h3>
                <p>{fileMeta ? `${file?.name}（${fileMeta}）` : file?.name}</p>
                <div className="gx-me2__skel">
                  <div className="gx-me2__sk" style={{ width: '38%' }} />
                  <div className="gx-me2__sk" style={{ width: '92%' }} />
                  <div className="gx-me2__sk" style={{ width: '80%' }} />
                  <div className="gx-me2__sk" style={{ width: '88%' }} />
                  <div className="gx-me2__sk" style={{ width: '60%' }} />
                </div>
                <div
                  className="gx-me2__note amber"
                  style={{
                    maxWidth: 520,
                    margin: '22px auto 0',
                    textAlign: 'left',
                  }}>
                  <IcInfo />
                  <span>{F.processingNote}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default GxMinutesFilePage;
