/**
 * 議事録ワークベンチ共通ロジック（Phase 2 / step 5）。
 *
 * デザインバンドル project/app/MEShared.jsx（useMEState の純フロントロジック）と
 * 着工方針メモ §13 を正とする、ビュー型・話者パレット・整形ユーティリティ・
 * 入口ドラフト（recordDraft / fileDraft）→ turns 正規化（§13.2）・S3 永続化型との
 * 相互変換をまとめる。React 非依存（state フックは useMEState.ts）。
 */
import {
  MeetingTranscript,
  MeetingTurn,
  Transcript,
} from 'generative-ai-use-cases';

// 追加話者用のカラーパレット（バンドル MEShared.SPK_COLORS と同値）。
// CSS トークンは JS から参照できないため、プロト同様 hex で持つ。
export const SPK_COLORS = [
  '#2d5be9',
  '#00b8b8',
  '#10915a',
  '#d68a0c',
  '#5b0ebe',
  '#d33a2c',
  '#0a7ea4',
  '#9a6206',
];

export const colorForSpk = (id: number): string =>
  id < 0 ? 'var(--gray-300)' : SPK_COLORS[id % SPK_COLORS.length];

// ワークベンチのビュー型（数値 spk id・色/アバターはインデックス由来）。
export type WBTurn = MeetingTurn;
export type WBSpeaker = { id: number; color: string; av: string };
export type WBInit = {
  names: Record<number, string>;
  speakers: WBSpeaker[];
  turns: WBTurn[];
  durationSec?: number;
};

export const fmtTime = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(ss)}`;
};

// spk_N ラベル → 数値 index（取れなければ -1）。
export const spkIndexOf = (spk?: string): number => {
  if (!spk) return -1;
  const m = /spk_(\d+)/.exec(spk);
  return m ? parseInt(m[1], 10) : -1;
};

// プレーンテキスト → 安全な HTML（contentEditable 表示用・タグ無害化）。
export const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// HTML → プレーンテキスト（分割の文字数按分・結合・LLM 入力で使う）。
export const plainText = (html: string): string => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent || '';
};

// 出現する spk id 集合から話者ロスター（色・アバター）を生成。
const rosterFromTurns = (
  turns: WBTurn[],
  extra: number[] = []
): WBSpeaker[] => {
  const ids = Array.from(new Set([...turns.map((t) => t.spk), ...extra]))
    .filter((id) => id >= 0)
    .sort((a, b) => a - b);
  return ids.map((id, i) => ({
    id,
    color: colorForSpk(id),
    av: String(i + 1),
  }));
};

// --- 入口ドラフト → WBInit（§13.2 正規化） ---

// recordDraft（mic）：連結済み LiveTurn 列。spk は spk_N の N。
export type RecordDraft = {
  source: 'mic';
  durationSec: number;
  turns: { id: string; spk?: string; atSec: number; text: string }[];
  markers?: { id: string; atSec: number; afterCount: number }[];
  speakerLabel?: boolean;
};

// fileDraft（batch）：生 Transcript[]（B4 で startTime/endTime 入り）。
export type FileDraft = {
  source: 'batch';
  fileName: string;
  sizeLabel?: string;
  durationLabel?: string;
  speakerLabel?: boolean;
  maxSpeakers?: number;
  transcripts: Transcript[];
  languageCode?: string;
};

export const normalizeRecordDraft = (d: RecordDraft): WBInit => {
  const turns: WBTurn[] = d.turns.map((t, i) => {
    const spk = spkIndexOf(t.spk);
    return {
      id: t.id || `turn-${i}`,
      spk,
      at: t.atSec,
      t: fmtTime(t.atSec),
      html: escapeHtml(t.text),
    };
  });
  return {
    names: {},
    speakers: rosterFromTurns(turns),
    turns,
    durationSec: d.durationSec,
  };
};

export const normalizeFileDraft = (d: FileDraft): WBInit => {
  // mark / lowConf は Transcribe から確度が取れないため v1 は付けない（§13.2）。
  const turns: WBTurn[] = d.transcripts
    .filter((tr) => tr.transcript && tr.transcript.trim() !== '')
    .map((tr, i) => {
      const spk = spkIndexOf(tr.speakerLabel);
      const at = tr.startTime ?? 0;
      return {
        id: `turn-${i}`,
        spk,
        at,
        t: fmtTime(at),
        html: escapeHtml(tr.transcript),
      };
    });
  const last = d.transcripts[d.transcripts.length - 1];
  const durationSec = last?.endTime;
  return { names: {}, speakers: rosterFromTurns(turns), turns, durationSec };
};

// --- 永続化（S3）型との相互変換 ---

// 持続化された MeetingTranscript → WBInit（既存会議を開くとき）。
export const fromTranscript = (tr: MeetingTranscript): WBInit => {
  const speakers = rosterFromTurns(tr.turns, tr.speakers);
  // names は Record<string,string>。WBInit は Record<number,string>。
  const names: Record<number, string> = {};
  Object.entries(tr.names || {}).forEach(([k, v]) => {
    names[Number(k)] = v;
  });
  return { names, speakers, turns: tr.turns, durationSec: tr.durationSec };
};

// WBState のスナップショット → MeetingTranscript（S3 へ保存するとき）。
export const toTranscript = (params: {
  source: MeetingTranscript['source'];
  durationSec?: number;
  names: Record<number, string>;
  speakers: WBSpeaker[];
  turns: WBTurn[];
  rev: number;
}): MeetingTranscript => {
  const names: Record<string, string> = {};
  Object.entries(params.names).forEach(([k, v]) => {
    if (v && v.trim()) names[k] = v;
  });
  return {
    source: params.source,
    durationSec: params.durationSec,
    names,
    speakers: params.speakers.map((s) => s.id),
    turns: params.turns,
    rev: params.rev,
  };
};
