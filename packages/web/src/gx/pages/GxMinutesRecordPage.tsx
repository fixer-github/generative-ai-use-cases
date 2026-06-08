/**
 * GxMinutesRecordPage — 議事録ワークベンチ「録音中（その場で文字起こし）」（Phase 2 / step 3b）。
 *
 * 着工方針：`Phase2_議事録ワークベンチ_着工方針メモ.md` §2.1・§5 step3・§9.4。
 * デザインバンドル project/app/MEntry.jsx の MRecording を移植。
 *
 * 仕分け（移植規約 1.3）：
 *   - (b) 再スキン型：ライブ文字起こしは現行 `useMicrophone`（partial / spk_N /
 *     startTime 保持済み）をそのまま流用し、表示だけ新UIへ。
 *   - (a) 新規UI型：ヘッダ・レベルメータ・操作ボタンは新規。「一時停止 / 再開」は
 *     useMicrophone に追加した pause/resume（トラックの enabled トグル）で実装、
 *     「目印（マーカー）」は本ページのローカル state（経過秒の記録）で実装する。
 *
 * このメモ増分のスコープ外（後続）：
 *   - 会議エンティティの作成（createMeeting）・録音音声の S3 並行保存（B7）・
 *     文字起こしの永続化は backend 未デプロイのため step 3b-2 / step 5 で結線する。
 *   - 停止後の遷移先（編集ワークベンチ）は step 5 で実体化する。現状は暫定で
 *     `/g/minutes/draft` プレースホルダへ、捕捉した文字起こし／目印を location.state
 *     （`recordDraft`）に載せて渡す（step 5 がこの受け渡し契約を確定する）。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Transcript } from 'generative-ai-use-cases';
import useMicrophone from '../../hooks/useMicrophone';
import {
  IcBack,
  IcPause,
  IcMic,
  IcStop,
  IcBookmark,
  IcInfo,
} from '../components/icons';
import { GX } from '../strings';
import '../styles/minutes-shared.css';
import '../styles/minutes-entry.css';

const R = GX.minutes.record;

// 追加話者用のカラーパレット（デザインバンドル MEShared.SPK_COLORS と同値）。
// トークンは CSS 変数のため JS からは参照できず、プロト同様 hex で持つ。
const SPK_COLORS = [
  '#2d5be9',
  '#00b8b8',
  '#10915a',
  '#d68a0c',
  '#5b0ebe',
  '#d33a2c',
  '#0a7ea4',
  '#9a6206',
];

const spkIndexOf = (spk?: string): number | null => {
  if (!spk) return null;
  const m = /spk_(\d+)/.exec(spk);
  return m ? parseInt(m[1], 10) : null;
};
const spkColor = (spk?: string) => {
  const i = spkIndexOf(spk);
  return i == null ? 'var(--gray-300)' : SPK_COLORS[i % SPK_COLORS.length];
};
const spkAvatar = (spk?: string) => {
  const i = spkIndexOf(spk);
  return i == null ? '?' : String(i + 1);
};
const spkName = (spk?: string) => {
  const i = spkIndexOf(spk);
  return i == null ? R.speakerUnknown : `spk_${i}`;
};

const fmtTime = (totalSec: number) => {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
};

type LiveTurn = { id: string; spk?: string; atSec: number; text: string };
type Marker = { id: string; atSec: number; afterCount: number };

// rawTranscripts（確定セグメントの配列・末尾のみ partial になりうる）から、
// 連続する同一話者をまとめた表示用の発話列と、認識中の partial テキストを導く。
const stripFor = (lang?: string) => (lang ?? 'ja-JP').startsWith('ja');
const buildTurns = (
  segs: {
    resultId: string;
    startTime: number;
    transcripts: Transcript[];
    languageCode?: string;
  }[]
): LiveTurn[] => {
  const out: LiveTurn[] = [];
  for (const seg of segs) {
    const strip = stripFor(seg.languageCode);
    for (const tr of seg.transcripts) {
      const text = strip ? tr.transcript.replace(/ /g, '') : tr.transcript;
      if (!text) continue;
      const prev = out[out.length - 1];
      if (prev && prev.spk === tr.speakerLabel) {
        prev.text += (strip ? '' : ' ') + text;
      } else {
        out.push({
          id: `turn-${out.length}`,
          spk: tr.speakerLabel,
          atSec: seg.startTime,
          text,
        });
      }
    }
  }
  return out;
};

const GxMinutesRecordPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    startTranscription,
    stopTranscription,
    pauseTranscription,
    resumeTranscription,
    paused,
    ready,
    recording,
    rawTranscripts,
  } = useMicrophone();

  const [elapsed, setElapsed] = useState(0);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const streamRef = useRef<HTMLDivElement>(null);

  // クライアント準備完了で1度だけ自動開始（話者分離オン・日本語）。
  // ready は client 初期化後に true へ変わるため、StrictMode のマウント時
  // 二重実行（ready=false）では発火せず、二重開始しない。
  const startedRef = useRef(false);
  useEffect(() => {
    if (ready && !startedRef.current) {
      startedRef.current = true;
      startTranscription('ja-JP', true);
    }
  }, [ready, startTranscription]);

  // 画面離脱時はマイクを止める（サイドバー遷移・ブラウザ戻る等を含む）。
  const stopRef = useRef(stopTranscription);
  stopRef.current = stopTranscription;
  useEffect(() => () => stopRef.current(), []);

  // 経過タイマー（録音中かつ一時停止でないときだけ進む）。
  useEffect(() => {
    if (!recording || paused) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [recording, paused]);

  const { turns, partialText } = useMemo(() => {
    const segs = rawTranscripts;
    const lastIsPartial = segs.length > 0 && segs[segs.length - 1].isPartial;
    const finalized = lastIsPartial ? segs.slice(0, -1) : segs;
    const partialSeg = lastIsPartial ? segs[segs.length - 1] : null;
    const strip = partialSeg ? stripFor(partialSeg.languageCode) : true;
    const pText = partialSeg
      ? partialSeg.transcripts
          .map((tr) =>
            strip ? tr.transcript.replace(/ /g, '') : tr.transcript
          )
          .join(strip ? '' : ' ')
          .trim()
      : '';
    return { turns: buildTurns(finalized), partialText: pText };
  }, [rawTranscripts]);

  // 目印追加時点の確定発話数（その後ろに目印を差し込む）を参照するための ref。
  const turnsCountRef = useRef(0);
  turnsCountRef.current = turns.length;
  const addMarker = useCallback(() => {
    setMarkers((m) => [
      ...m,
      {
        id: `mk-${m.length}-${Date.now()}`,
        atSec: elapsed,
        afterCount: turnsCountRef.current,
      },
    ]);
  }, [elapsed]);

  // 新しい発話・目印・partial が来たら末尾へ自動スクロール。
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, partialText, markers.length]);

  const onStop = useCallback(() => {
    stopTranscription();
    navigate('/g/minutes/draft', {
      state: {
        recordDraft: {
          source: 'mic',
          durationSec: elapsed,
          turns,
          markers,
          speakerLabel: true,
        },
      },
    });
  }, [stopTranscription, navigate, elapsed, turns, markers]);

  const onBack = useCallback(() => {
    stopTranscription();
    navigate('/g/minutes');
  }, [stopTranscription, navigate]);

  const meterPaused = paused || !recording;
  const meter = useMemo(
    () =>
      Array.from(
        { length: 90 },
        (_, i) => 0.2 + Math.abs(Math.sin(i * 1.7)) * 0.8
      ),
    []
  );

  const markersAt = (n: number) =>
    markers
      .filter((m) => m.afterCount === n)
      .map((m) => (
        <div className="gx-me2__markerline" key={m.id}>
          <IcBookmark />
          {R.markerLabel}
          <span className="at">{fmtTime(m.atSec)}</span>
        </div>
      ));

  const isEmpty = turns.length === 0 && !partialText;

  return (
    <div className="gx-me2">
      <header className="gx-me2__top">
        <button className="gx-me2__back" title={R.backTitle} onClick={onBack}>
          <IcBack />
        </button>
        <div>
          <div className="gx-me2__ttl">{R.title}</div>
          <div className="gx-me2__meta">
            <span className={'gx-me2__rec' + (paused ? ' paused' : '')}>
              <span className="pulse" />
              {paused ? R.statusPaused : R.statusRecording}
            </span>
            <span className="gx-me2__timer">{fmtTime(elapsed)}</span>
            <span>{R.speakerInfo}</span>
          </div>
        </div>
        <div className="gx-me2__sp" />
        <div className="gx-me2__recctl">
          <button
            className="gx-me2__ghost"
            onClick={paused ? resumeTranscription : pauseTranscription}
            disabled={!recording}>
            {paused ? <IcMic size={14} /> : <IcPause />}
            {paused ? R.resume : R.pause}
          </button>
          <button className="gx-me2__primary" onClick={onStop}>
            <IcStop size={14} />
            {R.stop}
          </button>
        </div>
      </header>

      <div className="gx-me2__scroll">
        <div className="gx-me2__wrap">
          {/* レベルメータ＋目印ボタン */}
          <div className="gx-me2__card gx-me2__level">
            <div className={'gx-me2__mic' + (meterPaused ? ' paused' : '')}>
              <IcMic size={20} />
            </div>
            <div className={'gx-me2__meter' + (meterPaused ? ' paused' : '')}>
              {meter.map((h, i) => (
                <span
                  key={i}
                  style={{
                    height: `${h * 100}%`,
                    animation: meterPaused
                      ? undefined
                      : `gx-me2-lv ${0.7 + (i % 5) * 0.12}s ease-in-out ${i * 0.02}s infinite`,
                  }}
                />
              ))}
            </div>
            <button
              className="gx-me2__ghost"
              onClick={addMarker}
              disabled={!recording || paused}>
              <IcBookmark />
              {R.marker}
            </button>
          </div>

          {/* 注記：話者割り当て・修正は停止後の編集画面で */}
          <div className="gx-me2__note">
            <IcInfo />
            <span>
              {R.noteLead}
              <b>{R.noteBold}</b>
            </span>
          </div>

          {/* ライブ文字起こし */}
          <div className="gx-me2__card gx-me2__streamcard">
            <div className="gx-me2__stream" ref={streamRef}>
              {isEmpty && (
                <div className="gx-me2__waiting">
                  <span className="dot" />
                  {R.waiting}
                </div>
              )}
              {markersAt(0)}
              {turns.map((t, i) => (
                <React.Fragment key={t.id}>
                  <div className="gx-me-turn gx-me2__turn">
                    <span
                      className="gx-me-av"
                      style={{ background: spkColor(t.spk) }}>
                      {spkAvatar(t.spk)}
                    </span>
                    <div>
                      <div className="gx-me-turn-meta">
                        <span className="gx-me-spk unnamed">
                          <span
                            className="gx-me-av"
                            style={{ background: spkColor(t.spk) }}>
                            {spkAvatar(t.spk)}
                          </span>
                          {spkName(t.spk)}
                        </span>
                        <span className="gx-me-ts">{fmtTime(t.atSec)}</span>
                      </div>
                      <div className="gx-me-text">{t.text}</div>
                    </div>
                  </div>
                  {markersAt(i + 1)}
                </React.Fragment>
              ))}

              {/* partial（認識中） */}
              {partialText && (
                <div className="gx-me-turn gx-me2__turn">
                  <span
                    className="gx-me-av"
                    style={{ background: 'var(--gray-300)' }}>
                    ?
                  </span>
                  <div>
                    <div className="gx-me-turn-meta">
                      <span className="gx-me-spk unnamed">
                        {R.partialSpeaker}
                      </span>
                      <span className="gx-me-ts">{fmtTime(elapsed)}</span>
                    </div>
                    <div className="gx-me-text gx-me2__partial">
                      {partialText}
                      <span className="gx-me2__cur" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GxMinutesRecordPage;
