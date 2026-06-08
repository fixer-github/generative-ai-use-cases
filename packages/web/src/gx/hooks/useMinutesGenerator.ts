/**
 * useMinutesGenerator — 文字起こしから構造化議事録を生成（Phase 2 / B5・§13.3）。
 *
 * 既存の同期 predict（useChatApi().predict）を流用し、話者ロスター（名前）と
 * turns（id・時刻つき）を渡して JSON を要求する。出力は要約／決定事項／ToDo の
 * 構造化（owner=話者 id・src=根拠発話 id・time=時刻）。プロト MEditA の setTimeout
 * ダミーを実生成に置き換えるもの。
 *
 * 堅牢性：JSON 以外の前後テキスト・コードフェンスを剥がして最初の {...} を採用。
 * パース失敗時は1度だけ厳格指示で再試行し、なお失敗なら例外（ページが握って
 * トーストする）。
 */
import { useCallback, useState } from 'react';
import {
  MeetingMinutesDoc,
  Model,
  UnrecordedMessage,
} from 'generative-ai-use-cases';
import useChatApi from '../../hooks/useChatApi';
import { MODELS } from '../../hooks/useModel';
import { WBTurn, plainText } from '../lib/minutes';

// LLM の生出力（owner は数値 id 想定。null 可）。
type RawDecision = {
  text?: string;
  owner?: number | string | null;
  src?: string;
  time?: string;
};
type RawTodo = {
  text?: string;
  owner?: number | string | null;
  due?: string;
  src?: string;
};
type RawMinutes = {
  summary?: string[];
  decisions?: RawDecision[];
  todos?: RawTodo[];
};

const SYSTEM_PROMPT = `あなたは会議の文字起こしから日本語の議事録を作成するアシスタントです。
入力は発話の配列で、各発話は「[発話id] (話者id:話者名) 時刻 本文」の形式です。
これを読み、以下の3つを抽出してください。

1. summary（要約）: 会議全体の要点を 2〜5 個の短い箇条書き（文字列の配列）。
2. decisions（決定事項）: 会議で決まったこと。各項目は text（決定内容）, owner（責任者の話者id・整数。特定できなければ null）, src（根拠となった発話id）, time（その発話の時刻 hh:mm:ss）。
3. todos（ToDo・宿題）: 今後の宿題。各項目は text（やること）, owner（担当者の話者id・整数。不明なら null）, due（期限。文中になければ空文字）, src（根拠となった発話id）。

制約:
- 出力は JSON オブジェクトのみ。前後に説明文・コードフェンス・改行以外の文字を一切付けないこと。
- owner は必ず入力に出てきた整数の話者id、または null。話者名や "spk_0" 等の文字列にしない。
- src は必ず入力に存在する発話id。
- 該当が無いセクションは空配列にする。
- JSON スキーマ: {"summary": string[], "decisions": [{"text": string, "owner": number|null, "src": string, "time": string}], "todos": [{"text": string, "owner": number|null, "due": string, "src": string}]}`;

// 入力本文（発話列を LLM 向けに整形）。
const buildInput = (
  turns: WBTurn[],
  displayName: (id: number) => string
): string =>
  turns
    .map(
      (t) =>
        `[${t.id}] (${t.spk}:${displayName(t.spk)}) ${t.t} ${plainText(t.html)}`
    )
    .join('\n');

// owner を string|null へ正規化（数値・数字文字列のみ採用）。
const normOwner = (v: number | string | null | undefined): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? String(n) : null;
};

// 生出力から最初の JSON オブジェクトを取り出してパース。
const extractJson = (raw: string): RawMinutes | null => {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as RawMinutes;
  } catch {
    return null;
  }
};

const toDoc = (raw: RawMinutes, genRev: number): MeetingMinutesDoc => ({
  summary: Array.isArray(raw.summary)
    ? raw.summary.filter((s) => typeof s === 'string' && s.trim())
    : [],
  decisions: Array.isArray(raw.decisions)
    ? raw.decisions
        .filter((d) => d && typeof d.text === 'string' && d.text.trim())
        .map((d, i) => ({
          id: `d${i}`,
          text: d.text as string,
          owner: normOwner(d.owner),
          src: d.src ?? '',
          time: d.time,
        }))
    : [],
  todos: Array.isArray(raw.todos)
    ? raw.todos
        .filter((k) => k && typeof k.text === 'string' && k.text.trim())
        .map((k, i) => ({
          id: `k${i}`,
          text: k.text as string,
          owner: normOwner(k.owner),
          due: k.due,
          src: k.src ?? '',
        }))
    : [],
  genRev,
});

export const useMinutesGenerator = () => {
  const { predict } = useChatApi();
  const [loading, setLoading] = useState(false);

  const generate = useCallback(
    async (
      turns: WBTurn[],
      displayName: (id: number) => string,
      genRev: number
    ): Promise<MeetingMinutesDoc> => {
      const model = MODELS.textModels[0] as Model | undefined;
      if (!model) throw new Error('No text model available');
      const input = buildInput(turns, displayName);

      setLoading(true);
      try {
        const ask = async (extra: string): Promise<string> => {
          const messages: UnrecordedMessage[] = [
            { role: 'system', content: SYSTEM_PROMPT + extra },
            { role: 'user', content: input },
          ];
          return predict({
            model,
            messages,
            id: `gx-minutes-${Date.now()}`,
          });
        };

        let raw = extractJson(await ask(''));
        if (!raw) {
          // 厳格指示で1度だけ再試行。
          raw = extractJson(
            await ask('\n\n重要: JSON オブジェクトだけを出力してください。')
          );
        }
        if (!raw) {
          throw new Error('議事録の生成結果を解析できませんでした');
        }
        return toDoc(raw, genRev);
      } finally {
        setLoading(false);
      }
    },
    [predict]
  );

  return { generate, loading };
};

export default useMinutesGenerator;
