/**
 * GxMinutesWorkbenchPage — 議事録 編集ワークベンチ（Phase 2 / step 5・この機能の心臓）。
 *
 * 着工方針：`Phase2_議事録ワークベンチ_着工方針メモ.md` §2.2・§5 step5・§13。
 * デザインバンドル project/app/MEditA.jsx（＋MEShared.jsx の useMEState）を移植。
 *
 * 仕分け（移植規約 1.3）：
 *   - (b) 再スキン型：純フロントの編集ロジック（按分・rev・統合）は useMEState
 *     （MEShared 由来）へ忠実移植。議事録生成は既存 predict を流用（B5）。
 *   - (a) 新規UI型：2ペイン・ロスター・要再生成バナー・空ステート等の見た目。
 *
 * 永続化（§13.4・本機能の本丸）：
 *   - 入口ドラフト（recordDraft / fileDraft・location.state）から開くと、会議を
 *     createMeeting で作成し、文字起こしを S3（transcript.json）へ保存。以後 rev 変化を
 *     デバウンス自動保存。議事録は生成・手編集のたび minutes.json へ保存。
 *   - 既存会議（/g/minutes/:meetingId）は findMeetingById で transcript / minutes を
 *     読み込んで再開。
 *   - backend 未デプロイ時は作成・保存が失敗するが、編集自体はローカルで継続でき、
 *     ヘッダに「未保存」を表示する（壊れた会議行を作らないための耐性）。
 *
 * v1 縮退（§2.5）：下部の波形スクラバー・音源再生は録音音源保存（B7）が入るまで
 * 凡例のみ。PDF 書き出し（B8）は本増分では未実装。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { MeetingMinutesDoc, MeetingSource } from 'generative-ai-use-cases';
import useMeetingApi from '../../hooks/useMeetingApi';
import useTranscribeApi from '../../hooks/useTranscribeApi';
import useChatList from '../../hooks/useChatList';
import { useMEState } from '../hooks/useMEState';
import { useMinutesGenerator } from '../hooks/useMinutesGenerator';
import {
  WBInit,
  RecordDraft,
  FileDraft,
  colorForSpk,
  normalizeRecordDraft,
  normalizeFileDraft,
  fromTranscript,
  toTranscript,
} from '../lib/minutes';
import {
  IcBack,
  IcSearch,
  IcSpark,
  IcRefresh,
  IcInfo,
  IcAlert,
  IcCheck,
  IcChevronDown,
  IcLink,
  IcSplit,
  IcMerge,
  IcPlus,
  IcTrash,
  IcDots,
  IcMinutes,
} from '../components/icons';
import { GX } from '../strings';
import '../styles/minutes-shared.css';
import '../styles/minutes-workbench.css';

const W = GX.minutes.workbench;

const stripMeetingPrefix = (id: string) => id.replace(/^meeting#/, '');

const fmtDuration = (totalSec?: number): string => {
  if (totalSec == null || !isFinite(totalSec)) return '';
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}時間${m % 60}分`;
  return `${m}分${String(sec).padStart(2, '0')}秒`;
};

const fmtDate = (epochMs?: number): string => {
  const d = epochMs ? new Date(epochMs) : new Date();
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
};

const fmtHM = (d: Date) =>
  d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

type GenStatus = 'empty' | 'loading' | 'ready';

const GxMinutesWorkbenchPage: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const api = useMeetingApi();
  const transcribeApi = useTranscribeApi();
  const chatList = useChatList();
  const { generate } = useMinutesGenerator();

  const st = useMEState();

  // 既存会議モード（URL に :meetingId）か、ドラフトモード（入口からの location.state）か。
  const existingId = params.meetingId; // bare uuid（/g/minutes/draft はパラメータ無し）
  const draftRef = useRef<RecordDraft | FileDraft | null>(
    (location.state as { recordDraft?: RecordDraft; fileDraft?: FileDraft })
      ?.recordDraft ??
      (location.state as { fileDraft?: FileDraft })?.fileDraft ??
      null
  );
  const isDraft = !existingId;

  // バッチ（B3）では入口ページが会議を先に作成し、その meetingId を渡してくる。
  // ドラフトモードでこれがあれば二重 createMeeting せず再利用する（着工方針メモ §6 / step 4-f）。
  const preCreatedMeetingId = (location.state as { meetingId?: string })
    ?.meetingId;

  // 既存会議の読み込み（ドラフト時は undefined キーで fetch しない）。
  const { data: found, error: findError } = api.findMeetingById(existingId);

  // --- 会議メタ・永続化状態 ---
  const [meetingId, setMeetingId] = useState<string | null>(
    existingId ?? preCreatedMeetingId ?? null
  );

  // B3 fetch-on-open（離脱後に戻ったバッチ会議の復旧）。完了検知は status だけ進める
  // ため、離脱中に完了した会議は transcriptKey が未設定のまま status=ready になる。
  // その場合だけ jobName で getTranscription を取りに行く（既存の自動ポーリングを流用）。
  // 永続化は最初の編集時の自動保存に委ねる（再取得は安価なので即時保存は強制しない）。
  const [recoverStatus, setRecoverStatus] = useState('');
  const recoveredRef = useRef(false);
  const needsRecovery =
    !isDraft &&
    !!found?.meeting &&
    !found?.transcript &&
    !!found?.meeting?.jobName;
  const { data: recoverData } = transcribeApi.getTranscription(
    needsRecovery ? found!.meeting!.jobName! : null,
    recoverStatus,
    setRecoverStatus
  );
  const [source, setSource] = useState<MeetingSource>('mic');
  const [title, setTitle] = useState<string>(W.defaultTitle);
  const [createdMs, setCreatedMs] = useState<number | undefined>(undefined);
  const [durationSec, setDurationSec] = useState<number | undefined>(undefined);
  const [initialized, setInitialized] = useState(false);

  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const lastSavedRev = useRef(-1);

  // --- 録音音声（B7：聞き返し） ---
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const objectUrlRef = useRef<string | null>(null); // 自前生成した URL のみ revoke
  const audioUploadedRef = useRef(false);

  // --- 議事録（手動生成） ---
  const [minutes, setMinutes] = useState<MeetingMinutesDoc | null>(null);
  const [gen, setGen] = useState<GenStatus>('empty');
  const [genRev, setGenRev] = useState(0);
  const [edited, setEdited] = useState(false); // 議事録を手編集したか
  const [confirm, setConfirm] = useState(false);
  const [genError, setGenError] = useState(false);

  // --- メニュー開閉 ---
  const [openSpk, setOpenSpk] = useState<string | null>(null); // 付け替え（turnId）
  const [chipMenu, setChipMenu] = useState<number | null>(null); // 統合（spkId）

  const scrollRef = useRef<HTMLDivElement>(null);
  const turnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 最新スナップショット（デバウンス保存時に参照する）。
  const snapRef = useRef({
    names: st.names,
    speakers: st.speakers,
    turns: st.turns,
    rev: st.rev,
    source,
    durationSec,
  });
  snapRef.current = {
    names: st.names,
    speakers: st.speakers,
    turns: st.turns,
    rev: st.rev,
    source,
    durationSec,
  };

  const staleGen = gen === 'ready' && st.rev !== genRev;

  // -------------------------------------------------------------------------
  // 初期化：ドラフト（入口から）／既存会議（バックエンドから）
  // -------------------------------------------------------------------------
  const createdRef = useRef(false);

  // ドラフトモード：正規化して即描画。会議作成は背後で（失敗しても編集は継続）。
  useEffect(() => {
    if (!isDraft || initialized) return;
    const d = draftRef.current;
    let init: WBInit;
    let src: MeetingSource;
    let defTitle: string = W.defaultTitle;
    if (d && d.source === 'mic') {
      init = normalizeRecordDraft(d);
      src = 'mic';
    } else if (d && d.source === 'batch') {
      init = normalizeFileDraft(d);
      src = 'batch';
      defTitle = d.fileName?.replace(/\.[^.]+$/, '') || W.defaultTitle;
    } else {
      // ドラフトが無い（直接遷移など）：空で開く。
      init = { names: {}, speakers: [], turns: [] };
      src = 'mic';
    }
    st.load(init, 0);
    setSource(src);
    setTitle(defTitle);
    setDurationSec(init.durationSec);
    setCreatedMs(Date.now());
    lastSavedRev.current = -1; // 未保存（最初の保存を促す）
    // 録音音声があれば即時にローカル URL で再生可能にする（S3 往復を待たない）。
    if (d && d.source === 'mic' && d.audio) {
      const url = URL.createObjectURL(d.audio.blob);
      objectUrlRef.current = url;
      setAudioUrl(url);
    }
    setInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraft, initialized]);

  // 自前生成したオブジェクト URL の後始末（presigned URL は対象外）。
  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    []
  );

  // ドラフトモード：会議エンティティを1度だけ作成（status は最初の保存で ready に）。
  useEffect(() => {
    if (!isDraft || !initialized || createdRef.current || meetingId) return;
    createdRef.current = true;
    (async () => {
      try {
        const res = await api.createMeeting({ source, title });
        setMeetingId(stripMeetingPrefix(res.meeting.meetingId));
        setCreatedMs(Number(res.meeting.createdDate) || Date.now());
      } catch (e) {
        // backend 未デプロイ等：作成失敗。編集は継続し「未保存」を表示。
        console.log('createMeeting failed', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraft, initialized, source, title]);

  // 既存会議モード：fetch 完了でハイドレート（1度だけ）。
  useEffect(() => {
    if (isDraft || initialized) return;
    if (findError) {
      setInitialized(true); // エラー表示へ
      return;
    }
    if (!found) return;
    const m = found.meeting;
    if (!m) {
      setInitialized(true);
      return;
    }
    const init = found.transcript
      ? fromTranscript(found.transcript)
      : { names: {}, speakers: [], turns: [] };
    st.load(init, m.rev);
    lastSavedRev.current = m.rev;
    setSource(m.source);
    setTitle(m.title || W.defaultTitle);
    setCreatedMs(Number(m.createdDate) || undefined);
    setDurationSec(found.transcript?.durationSec);
    audioUploadedRef.current = true; // 既存会議は再アップロード不要
    if (found.audioUrl) setAudioUrl(found.audioUrl);
    if (found.minutes) {
      setMinutes(found.minutes);
      setGen('ready');
      setGenRev(found.minutes.genRev ?? m.genRev ?? m.rev);
    }
    setSavedAt(new Date(Number(m.updatedDate) || Date.now()));
    setInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraft, initialized, found, findError]);

  // 既存モードのバッチ復旧：getTranscription が完了データを返したら editor へ流し込む
  // （表示が成立）。永続化（transcriptKey）は最初の編集時の自動保存に任せる。まだ
  // 文字起こし中なら（IN_PROGRESS）2秒間隔の自動ポーリングで待ち、完了後に流入する。
  useEffect(() => {
    if (!needsRecovery || recoveredRef.current) return;
    const trs = recoverData?.transcripts;
    if (!trs || trs.length === 0) return;
    recoveredRef.current = true;
    const init = normalizeFileDraft({
      source: 'batch',
      fileName: title,
      transcripts: trs,
      languageCode: recoverData?.languageCode,
    });
    st.load(init, found?.meeting?.rev ?? 0);
    setDurationSec(init.durationSec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRecovery, recoverData]);

  // -------------------------------------------------------------------------
  // 永続化：文字起こしの自動保存（rev 変化をデバウンス）／議事録の保存
  // -------------------------------------------------------------------------
  const saveTranscript = useCallback(async () => {
    if (!meetingId) return;
    const snap = snapRef.current;
    setSaving(true);
    try {
      const firstSave = lastSavedRev.current < 0;
      await api.updateMeeting(meetingId, {
        transcript: toTranscript(snap),
        rev: snap.rev,
        ...(firstSave ? { status: 'ready' as const } : {}),
        speakers: snap.speakers.map((s) => ({
          id: String(s.id),
          name: st.displayName(s.id),
        })),
      });
      lastSavedRev.current = snap.rev;
      setSavedAt(new Date());
    } catch (e) {
      console.log('saveTranscript failed', e);
    } finally {
      setSaving(false);
    }
  }, [meetingId, api, st]);

  // rev 変化／会議作成完了でデバウンス保存。
  useEffect(() => {
    if (!initialized || !meetingId) return;
    if (st.rev === lastSavedRev.current) return;
    const id = setTimeout(saveTranscript, 1200);
    return () => clearTimeout(id);
  }, [initialized, meetingId, st.rev, saveTranscript]);

  // 録音音声の S3 アップロード（B7）：会議作成後に1度だけ。署名URL→直PUT→audioKey 保存。
  useEffect(() => {
    if (!meetingId || audioUploadedRef.current) return;
    const d = draftRef.current;
    const audio = d && d.source === 'mic' ? d.audio : undefined;
    if (!audio) return;
    audioUploadedRef.current = true;
    (async () => {
      try {
        const { url, audioKey } = await api.getAudioUploadUrl(
          meetingId,
          audio.ext
        );
        await api.uploadAudio(url, audio.blob, audio.mimeType);
        await api.updateMeeting(meetingId, { audioKey });
      } catch (e) {
        // backend 未デプロイ等：アップロード失敗。ローカル URL での再生は継続。
        console.log('audio upload failed', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // タイムスタンプ／根拠リンクから音声を該当時刻へシークして再生（聞き返し）。
  const seekTo = useCallback((sec: number) => {
    const el = audioRef.current;
    if (!el || !isFinite(sec)) return;
    el.currentTime = Math.max(0, sec);
    el.play().catch(() => {
      // 自動再生がブロックされた場合はシークのみ（ユーザーが再生を押せる）。
    });
  }, []);

  const saveMinutes = useCallback(
    async (doc: MeetingMinutesDoc) => {
      if (!meetingId) return;
      try {
        await api.updateMeeting(meetingId, {
          minutes: doc,
          genRev: doc.genRev,
        });
        setSavedAt(new Date());
      } catch (e) {
        console.log('saveMinutes failed', e);
      }
    },
    [meetingId, api]
  );

  // 会議タイトルのインライン編集確定（純フロント・小物A）。空はガードして既定名へ。
  // meetingId があれば updateMeeting({title})→サイドバー履歴(useChatList)を再検証。
  // draft（meetingId 未確定）は title state のみ更新し、初回 createMeeting の title 引数に
  // 乗る。transcript/minutes の自動保存とは独立経路でレースしない。
  const commitTitle = useCallback(
    (next: string) => {
      const finalTitle = next.trim() || W.defaultTitle;
      if (finalTitle === title) return;
      const prev = title;
      setTitle(finalTitle); // 楽観更新
      if (!meetingId) return; // draft：createMeeting の title に乗る
      api
        .updateMeeting(meetingId, { title: finalTitle })
        .then(() => {
          setSavedAt(new Date());
          chatList.mutate(); // 投影行はサーバ側でミラー済み。再検証で行名を即時更新
        })
        .catch((e) => {
          // backend 未デプロイ等：保存失敗。元値へ復帰（壊れた表示を残さない）。
          console.log('updateMeeting title failed', e);
          setTitle(prev);
        });
    },
    [title, meetingId, api, chatList]
  );

  // -------------------------------------------------------------------------
  // 議事録生成（B5）
  // -------------------------------------------------------------------------
  const runGenerate = useCallback(async () => {
    setConfirm(false);
    setGenError(false);
    setGen('loading');
    try {
      const doc = await generate(st.turns, st.displayName, st.rev);
      setMinutes(doc);
      setGenRev(st.rev);
      setEdited(false);
      setGen('ready');
      saveMinutes(doc);
    } catch (e) {
      console.log('generate minutes failed', e);
      setGenError(true);
      setGen(minutes ? 'ready' : 'empty');
    }
  }, [generate, st.turns, st.displayName, st.rev, saveMinutes, minutes]);

  const onRegen = useCallback(() => {
    if (edited) setConfirm(true);
    else runGenerate();
  }, [edited, runGenerate]);

  // 議事録の手編集を minutes state へ反映（blur 確定）。デバウンス保存。
  const minutesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitMinutes = useCallback(
    (next: MeetingMinutesDoc) => {
      setMinutes(next);
      setEdited(true);
      if (minutesSaveTimer.current) clearTimeout(minutesSaveTimer.current);
      minutesSaveTimer.current = setTimeout(() => saveMinutes(next), 1200);
    },
    [saveMinutes]
  );

  // -------------------------------------------------------------------------
  // 根拠リンク／要確認で active が変わったら左ペインを該当発言まで中央スクロール。
  // -------------------------------------------------------------------------
  useEffect(() => {
    const c = scrollRef.current;
    const el = st.active ? turnRefs.current[st.active] : null;
    if (!c || !el) return;
    const cr = c.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const delta = er.top - cr.top - (c.clientHeight - el.clientHeight) / 2;
    c.scrollTo({ top: c.scrollTop + delta, behavior: 'smooth' });
  }, [st.active, st.turns.length]);

  const closeAll = useCallback(() => {
    setOpenSpk(null);
    setChipMenu(null);
  }, []);

  // --- 表示用 ---
  const saveLabel = saving
    ? W.saving
    : !meetingId && lastSavedRev.current < 0 && st.rev > 0
      ? W.unsaved
      : savedAt
        ? `${W.savedPrefix} ${fmtHM(savedAt)}`
        : W.autosave;
  const dirty = !meetingId && st.rev > 0;
  const dateLabel = fmtDate(createdMs);
  const durationLabel = fmtDuration(durationSec);

  // 読み込み中／エラー（既存会議モード）
  if (isDraft && !initialized) {
    return <div className="gx-meA" />;
  }
  if (!isDraft && !initialized) {
    return (
      <div className="gx-meA">
        <div className="gx-meA__center">
          <div className="gx-meA__ring" />
          {W.loading}
        </div>
      </div>
    );
  }
  if (!isDraft && (findError || !found?.meeting)) {
    return (
      <div className="gx-meA">
        <div className="gx-meA__center">
          <IcAlert size={28} />
          {W.loadError}
          <button
            className="gx-meA__back"
            style={{ width: 'auto', padding: '0 14px', gap: 6 }}
            onClick={() => navigate('/g/minutes')}>
            <IcBack /> {W.backTitle}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gx-meA" onClick={closeAll}>
      {/* ヘッダ */}
      <div className="gx-meA__top">
        <button
          className="gx-meA__back"
          title={W.backTitle}
          onClick={() => navigate('/g/minutes')}>
          <IcBack />
        </button>
        <div>
          <EditableTitle value={title} onCommit={commitTitle} />
          <div className="gx-meA__meta">
            <span>{dateLabel}</span>
            {durationLabel && <span>{durationLabel}</span>}
          </div>
        </div>
        <div className="gx-meA__sp" />
        <div className="gx-meA__acts">
          <span className={'gx-meA__save' + (dirty ? ' dirty' : '')}>
            <span className="d" />
            {saveLabel}
          </span>
          {st.lowConfCount > 0 ? (
            <button
              className="gx-meA__triage"
              onClick={(e) => {
                e.stopPropagation();
                st.gotoNextLowConf();
              }}>
              {W.triagePrefix} {st.lowConfCount}
              {W.triageSuffix}
              <span className="nx">
                {W.triageNext}
                <IcChevronDown
                  size={11}
                  style={{ transform: 'rotate(-90deg)' }}
                />
              </span>
            </button>
          ) : (
            <span className="gx-meA__triage clear">
              <IcCheck size={13} />
              {W.triageClear}
            </span>
          )}
        </div>
      </div>

      {/* 話者ロスター */}
      <div className="gx-meA__roster" onClick={(e) => e.stopPropagation()}>
        <div className="lab">
          <b>{W.rosterTitle}</b>
          <span>{W.rosterCount(st.speakers.length, st.namedCount)}</span>
        </div>
        <div className="chips">
          {st.speakers.map((s) => {
            const named = st.isNamed(s.id);
            return (
              <div
                key={s.id}
                className={
                  'gx-me-roster-chip gx-meA__chip-wrap' +
                  (named ? ' named' : '')
                }>
                <span className="gx-me-av" style={{ background: s.color }}>
                  {s.av}
                </span>
                <div className="nf">
                  <input
                    value={st.names[s.id] || ''}
                    placeholder={W.rosterPlaceholder(s.id)}
                    onChange={(e) => st.nameSpeaker(s.id, e.target.value)}
                  />
                </div>
                <button
                  className="gx-meA__chip-more"
                  title={W.mergeHeading(st.displayName(s.id))}
                  onClick={() => setChipMenu(chipMenu === s.id ? null : s.id)}>
                  <IcDots size={15} />
                </button>
                {chipMenu === s.id && (
                  <div className="gx-meA__chip-menu">
                    <div className="h">
                      {W.mergeHeading(st.displayName(s.id))}
                    </div>
                    {st.speakers
                      .filter((x) => x.id !== s.id)
                      .map((x) => (
                        <button
                          key={x.id}
                          onClick={() => {
                            st.mergeSpeaker(s.id, x.id);
                            setChipMenu(null);
                          }}>
                          <span className="av2" style={{ background: x.color }}>
                            {x.av}
                          </span>
                          {W.mergeInto(st.displayName(x.id))}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
          <button className="gx-meA__addspk" onClick={st.addSpeaker}>
            <IcPlus size={14} />
            {W.addSpeaker}
          </button>
        </div>
      </div>

      {/* 2ペイン */}
      <div className="gx-meA__panes">
        {/* 文字起こし */}
        <section className="gx-meA__pane">
          <div className="gx-meA__ph">
            <h3>{W.transcriptTitle}</h3>
            <span className="cnt">{W.turnCount(st.turns.length)}</span>
            <span className="sp" />
            <button className="gx-meA__tool">
              <IcSearch size={11} />
              {W.search}
            </button>
          </div>
          <div className="gx-meA__scroll" ref={scrollRef}>
            {st.turns.map((t, ti) => (
              <div
                key={t.id}
                ref={(el) => (turnRefs.current[t.id] = el)}
                className={
                  'gx-me-turn' +
                  (st.active === t.id ? ' active' : '') +
                  (t.lowConf ? ' lowconf' : '')
                }
                onClick={() => st.setActive(t.id)}>
                <span
                  className="gx-me-av"
                  style={{ background: st.colorOf(t.spk) }}>
                  {st.avOf(t.spk)}
                </span>
                <div>
                  <div className="gx-me-turn-meta">
                    <span style={{ position: 'relative' }}>
                      <button
                        className={
                          'gx-me-spk click' +
                          (st.isNamed(t.spk) ? '' : ' unnamed')
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          setChipMenu(null);
                          setOpenSpk(openSpk === t.id ? null : t.id);
                        }}>
                        <span
                          className="gx-me-av"
                          style={{ background: st.colorOf(t.spk) }}>
                          {st.avOf(t.spk)}
                        </span>
                        {st.displayName(t.spk)}
                        <IcChevronDown size={11} className="car" />
                      </button>
                      {openSpk === t.id && (
                        <div
                          className="gx-me-menu"
                          onClick={(e) => e.stopPropagation()}>
                          <div className="gx-me-menu-h">
                            {W.reassignHeading}
                          </div>
                          <div className="gx-me-menu-list">
                            {st.speakers.map((s) => (
                              <button
                                key={s.id}
                                className={
                                  'gx-me-menu-row' +
                                  (s.id === t.spk ? ' on' : '')
                                }
                                onClick={() => {
                                  st.reassign(t.id, s.id);
                                  setOpenSpk(null);
                                }}>
                                <span
                                  className="gx-me-av sm"
                                  style={{ background: s.color }}>
                                  {s.av}
                                </span>
                                <span className="gx-me-menu-nm">
                                  {st.displayName(s.id)}
                                </span>
                                {s.id === t.spk && (
                                  <IcCheck
                                    size={13}
                                    className="gx-me-menu-ck"
                                  />
                                )}
                              </button>
                            ))}
                          </div>
                          <div className="gx-me-menu-foot">
                            <IcInfo size={12} />
                            {W.reassignFoot}
                          </div>
                        </div>
                      )}
                    </span>
                    <span
                      className={'gx-me-ts' + (audioUrl ? ' seek' : '')}
                      title={audioUrl ? W.seekTitle : undefined}
                      onClick={
                        audioUrl
                          ? (e) => {
                              e.stopPropagation();
                              seekTo(t.at);
                            }
                          : undefined
                      }>
                      {t.t}
                    </span>
                    {t.est && (
                      <span className="gx-me-est">
                        <IcInfo size={9} />
                        {W.estLabel}
                      </span>
                    )}
                    {t.manual && (
                      <span className="gx-me-est">{W.manualLabel}</span>
                    )}
                    {t.lowConf && (
                      <span className="gx-me-flag">
                        <IcAlert size={10} />
                        {W.lowConfLabel}
                      </span>
                    )}
                  </div>
                  <div
                    className={'gx-me-text' + (t.manual ? ' empty' : '')}
                    contentEditable
                    suppressContentEditableWarning
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) =>
                      st.editTurnHtml(t.id, e.currentTarget.innerHTML)
                    }
                    dangerouslySetInnerHTML={{ __html: t.html }}
                  />
                </div>
                {/* ホバー操作ツールバー */}
                <div
                  className="gx-meA__tools"
                  onClick={(e) => e.stopPropagation()}>
                  <button
                    className="gx-meA__tt"
                    title={W.tipSplit}
                    onClick={() => st.splitTurn(t.id)}>
                    <IcSplit size={13} />
                  </button>
                  {ti < st.turns.length - 1 && (
                    <button
                      className="gx-meA__tt"
                      title={W.tipMerge}
                      onClick={() => st.mergeWithNext(t.id)}>
                      <IcMerge size={13} />
                    </button>
                  )}
                  <button
                    className="gx-meA__tt"
                    title={W.tipAdd}
                    onClick={() => st.addTurnAfter(t.id)}>
                    <IcPlus size={13} />
                  </button>
                  <button
                    className="gx-meA__tt del"
                    title={W.tipDelete}
                    onClick={() => st.deleteTurn(t.id)}>
                    <IcTrash size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 議事録（手動生成） */}
        <section className="gx-meA__pane r">
          <div className="gx-meA__ph">
            <h3>{W.minutesTitle}</h3>
            <span className="sp" />
            {gen === 'ready' && !staleGen && (
              <span className="gx-meA__gensync">
                <IcCheck size={12} />
                {W.genSynced}
              </span>
            )}
            {gen === 'ready' && minutes && (
              <button
                className="gx-meA__tool"
                style={{ marginLeft: 8 }}
                onClick={(e) => {
                  e.stopPropagation();
                  window.print();
                }}>
                <IcMinutes size={11} />
                {W.pdfButton}
              </button>
            )}
            {gen === 'ready' && (
              <span
                style={{ position: 'relative' }}
                onClick={(e) => e.stopPropagation()}>
                <button
                  className="gx-meA__tool"
                  style={{ marginLeft: 8 }}
                  onClick={onRegen}>
                  <IcRefresh size={11} />
                  {W.regen}
                </button>
                {confirm && (
                  <div className="gx-meA__confirm">
                    <h4>{W.confirmTitle}</h4>
                    <p>{W.confirmDesc}</p>
                    <div className="row">
                      <button
                        className="c-cancel"
                        onClick={() => setConfirm(false)}>
                        {W.confirmCancel}
                      </button>
                      <button className="c-ok" onClick={runGenerate}>
                        {W.confirmOk}
                      </button>
                    </div>
                  </div>
                )}
              </span>
            )}
          </div>
          <div
            className="gx-meA__scroll gx-meA__min"
            onClick={(e) => e.stopPropagation()}>
            {gen === 'empty' && (
              <div className="gx-meA__empty">
                <div className="gx-meA__empty-card">
                  <div className="ic">
                    <IcSpark size={30} />
                  </div>
                  <h3>{W.emptyTitle}</h3>
                  <p>{W.emptyDesc}</p>
                  <div className="gx-meA__ghosts">
                    <span className="gx-meA__ghost">{W.ghostSummary}</span>
                    <span className="gx-meA__ghost">{W.ghostDecisions}</span>
                    <span className="gx-meA__ghost">{W.ghostTodos}</span>
                  </div>
                  <button
                    className="gx-meA__gen"
                    onClick={runGenerate}
                    disabled={st.turns.length === 0}>
                    <IcSpark size={17} />
                    {W.genButton}
                  </button>
                  {genError && (
                    <div
                      className="gx-meA__hint"
                      style={{ color: 'var(--danger-500)' }}>
                      <IcAlert size={13} />
                      {W.genError}
                    </div>
                  )}
                  <div className="gx-meA__hint">
                    <IcInfo size={13} />
                    {W.genHint}
                  </div>
                </div>
              </div>
            )}
            {gen === 'loading' && (
              <div className="gx-meA__loading">
                <div className="gx-meA__ring" />
                <h3>{W.loadingTitle}</h3>
                <p>{W.loadingDesc}</p>
              </div>
            )}
            {gen === 'ready' && minutes && (
              <>
                {staleGen && (
                  <div className="gx-meA__stale">
                    <IcAlert size={17} className="w" />
                    <div>
                      <b>{W.staleTitle}</b>
                      <p>{W.staleDesc}</p>
                    </div>
                    <div className="sp" />
                    <button className="gx-meA__regen" onClick={onRegen}>
                      <IcRefresh size={13} />
                      {W.regen}
                    </button>
                  </div>
                )}
                <MinutesDoc
                  minutes={minutes}
                  st={st}
                  dateLabel={dateLabel}
                  timeLabel={durationLabel}
                  onEdit={commitMinutes}
                />
              </>
            )}
          </div>
        </section>
      </div>

      {/* 下部：録音音声プレーヤー（B7・聞き返し）＋話者凡例（波形色分けは §2.5 縮退） */}
      <div className="gx-meA__foot" onClick={(e) => e.stopPropagation()}>
        {audioUrl && (
          <audio
            ref={audioRef}
            className="gx-meA__player"
            src={audioUrl}
            controls
            preload="metadata"
          />
        )}
        <div className="gx-meA__legend">
          <span className="lb">話者</span>
          {st.speakers.map((s) => (
            <span key={s.id} className="it">
              <span className="sw" style={{ background: s.color }} />
              {st.displayName(s.id)}
            </span>
          ))}
        </div>
      </div>

      {/* B8 PDF 書き出し用の清書専用ビュー（画面では非表示・@media print でのみ可視）。
          編集UI を一切含まず、構造化議事録（MeetingMinutesDoc）のみを清書する。 */}
      {gen === 'ready' && minutes && (
        <MinutesPrintView
          title={title}
          minutes={minutes}
          st={st}
          dateLabel={dateLabel}
          timeLabel={durationLabel}
        />
      )}
    </div>
  );
};

// --- 会議タイトルのインライン編集（表示↔input トグル。確定＝blur/Enter・取消＝Esc） ---
const EditableTitle: React.FC<{
  value: string;
  onCommit: (next: string) => void;
}> = ({ value, onCommit }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const begin = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    onCommit(draft);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="gx-meA__ttl-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
      />
    );
  }
  return (
    <div
      className="gx-meA__ttl gx-meA__ttl-edit"
      title={W.titleEditHint}
      onClick={begin}>
      {value}
    </div>
  );
};

// --- PDF 書き出し用の清書ビュー（B8）。構造化議事録のみ。@media print でのみ可視 ---
const MinutesPrintView: React.FC<{
  title: string;
  minutes: MeetingMinutesDoc;
  st: ReturnType<typeof useMEState>;
  dateLabel: string;
  timeLabel: string;
}> = ({ title, minutes, st, dateLabel, timeLabel }) => {
  const ownerName = (owner: string | null) =>
    owner === null ? '' : st.displayName(Number(owner));
  return (
    <div className="gx-meA__print">
      <h1 className="gx-pr__title">{title}</h1>
      <div className="gx-pr__meta">
        <div>
          <span className="k">{W.docDate}</span>
          {dateLabel}
          {timeLabel ? ` ・ ${timeLabel}` : ''}
        </div>
        <div>
          <span className="k">{W.docAttendees}</span>
          {st.speakers.map((s) => st.displayName(s.id)).join('、')}
        </div>
      </div>

      <section className="gx-pr__sec">
        <h2>{W.secSummary}</h2>
        {minutes.summary.length === 0 ? (
          <p className="gx-pr__empty">{W.emptyMinutesSection}</p>
        ) : (
          <ul>
            {minutes.summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="gx-pr__sec">
        <h2>{W.secDecisions}</h2>
        {minutes.decisions.length === 0 ? (
          <p className="gx-pr__empty">{W.emptyMinutesSection}</p>
        ) : (
          minutes.decisions.map((d) => (
            <div key={d.id} className="gx-pr__item">
              <div className="t">{d.text}</div>
              {d.owner !== null && (
                <div className="o">
                  {W.docOwner}：{ownerName(d.owner)}
                </div>
              )}
            </div>
          ))
        )}
      </section>

      <section className="gx-pr__sec">
        <h2>{W.secTodos}</h2>
        {minutes.todos.length === 0 ? (
          <p className="gx-pr__empty">{W.emptyMinutesSection}</p>
        ) : (
          minutes.todos.map((k) => (
            <div key={k.id} className="gx-pr__item">
              <div className="t">{k.text}</div>
              {(k.owner !== null || k.due) && (
                <div className="o">
                  {k.owner !== null && (
                    <>
                      {W.docOwner}：{ownerName(k.owner)}
                    </>
                  )}
                  {k.owner !== null && k.due ? ' ・ ' : ''}
                  {k.due ? `${W.docDue}：${k.due}` : ''}
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
};

// --- 議事録ドキュメント本体（生成された minutes から描画。手編集は blur で確定） ---
const MinutesDoc: React.FC<{
  minutes: MeetingMinutesDoc;
  st: ReturnType<typeof useMEState>;
  dateLabel: string;
  timeLabel: string;
  onEdit: (next: MeetingMinutesDoc) => void;
}> = ({ minutes, st, dateLabel, timeLabel, onEdit }) => {
  const ownerNode = (owner: string | null) => {
    if (owner === null) return null;
    const id = Number(owner);
    return (
      <span className="gx-me-owner">
        <span className="gx-me-av sm" style={{ background: colorForSpk(id) }}>
          {st.avOf(id)}
        </span>
        {st.displayName(id)}
      </span>
    );
  };

  const editSummary = (i: number, text: string) => {
    if (minutes.summary[i] === text) return;
    const summary = minutes.summary.slice();
    summary[i] = text;
    onEdit({ ...minutes, summary });
  };
  const editDecision = (i: number, text: string) => {
    if (minutes.decisions[i].text === text) return;
    const decisions = minutes.decisions.slice();
    decisions[i] = { ...decisions[i], text };
    onEdit({ ...minutes, decisions });
  };
  const editTodo = (i: number, text: string) => {
    if (minutes.todos[i].text === text) return;
    const todos = minutes.todos.slice();
    todos[i] = { ...todos[i], text };
    onEdit({ ...minutes, todos });
  };

  return (
    <div className="gx-me-doc">
      <div className="gx-me-doc-meta">
        <div className="r">
          <span className="k">{W.docDate}</span>
          <span className="v">
            {dateLabel}
            {timeLabel ? ` ・ ${timeLabel}` : ''}
          </span>
        </div>
        <div className="r">
          <span className="k">{W.docAttendees}</span>
          <span className="v">
            {st.speakers.map((s) => st.displayName(s.id)).join('、')}
          </span>
        </div>
      </div>

      <div>
        <div className="gx-me-sec-h">
          <span className="bar" />
          {W.secSummary}
        </div>
        {minutes.summary.length === 0 && (
          <div className="gx-me-li">{W.emptyMinutesSection}</div>
        )}
        {minutes.summary.map((s, i) => (
          <div key={i} className="gx-me-li">
            <span className="b" />
            <span
              style={{ flex: 1 }}
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => editSummary(i, e.currentTarget.textContent || '')}>
              {s}
            </span>
          </div>
        ))}
      </div>

      <div>
        <div className="gx-me-sec-h">
          <span className="bar" />
          {W.secDecisions}
        </div>
        {minutes.decisions.length === 0 && (
          <div className="gx-me-li">{W.emptyMinutesSection}</div>
        )}
        {minutes.decisions.map((d, i) => (
          <div key={d.id} className="gx-me-card">
            <div className="top">
              <span className="ck">
                <IcCheck size={13} />
              </span>
              <div style={{ flex: 1 }}>
                <div
                  className="txt"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) =>
                    editDecision(i, e.currentTarget.textContent || '')
                  }>
                  {d.text}
                </div>
                <div className="foot">
                  {ownerNode(d.owner)}
                  {d.src && (
                    <button
                      className="gx-me-ref"
                      onClick={() => st.setActive(d.src)}>
                      <IcLink size={11} />
                      {W.evidence} {d.time || ''}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="gx-me-sec-h">
          <span className="bar" />
          {W.secTodos}
        </div>
        {minutes.todos.length === 0 && (
          <div className="gx-me-li">{W.emptyMinutesSection}</div>
        )}
        {minutes.todos.map((k, i) => (
          <div key={k.id} className="gx-me-card todo">
            <div className="top">
              <span className="ck">
                <IcCheck size={13} />
              </span>
              <div style={{ flex: 1 }}>
                <div
                  className="txt"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) =>
                    editTodo(i, e.currentTarget.textContent || '')
                  }>
                  {k.text}
                </div>
                <div className="foot">
                  {ownerNode(k.owner)}
                  {k.due && <span className="gx-me-due">{k.due}</span>}
                  {k.src && (
                    <button
                      className="gx-me-ref"
                      onClick={() => st.setActive(k.src)}>
                      <IcLink size={11} />
                      {W.evidence}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GxMinutesWorkbenchPage;
