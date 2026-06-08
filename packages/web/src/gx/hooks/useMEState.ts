/**
 * useMEState — 議事録ワークベンチの共有状態フック（Phase 2 / step 5）。
 *
 * デザインバンドル MEShared.jsx の useMEState（純フロントロジック）を TS へ移植。
 * 着工方針メモ §13.1 を正とする。プロトとの差分：
 *   - 静的 TRANSCRIPT 初期化をやめ、空で初期化 → `load()` で入口ドラフト／既存会議
 *     から流し込む（永続化のため）。
 *   - `savedAt` は本フックでは持たない（実保存の完了時刻はページが管理）。`rev` の
 *     増分のみを担い、ページはこれを観測して自動保存と「要再生成」を判定する。
 *   - 本文の手編集を state に反映する `editTurnHtml` を追加（永続化に必須）。
 */
import { useCallback, useState } from 'react';
import {
  WBInit,
  WBSpeaker,
  WBTurn,
  SPK_COLORS,
  colorForSpk,
  fmtTime,
  plainText,
} from '../lib/minutes';

export type MEState = ReturnType<typeof useMEState>;

export const useMEState = () => {
  const [names, setNames] = useState<Record<number, string>>({});
  const [speakers, setSpeakers] = useState<WBSpeaker[]>([]);
  const [turns, setTurns] = useState<WBTurn[]>([]);
  const [active, setActive] = useState<string | null>(null);
  // 文字起こし／話者の変更回数（再生成要否＝staleGen の源）。
  const [rev, setRev] = useState(0);
  const touch = useCallback(() => setRev((r) => r + 1), []);

  // 入口ドラフト／既存会議からの流し込み（rev は基準値で初期化）。
  const load = useCallback((init: WBInit, baseRev = 0) => {
    setNames(init.names);
    setSpeakers(init.speakers);
    setTurns(init.turns);
    setRev(baseRev);
    const firstLowConf = init.turns.find((t) => t.lowConf);
    setActive((firstLowConf ?? init.turns[0])?.id ?? null);
  }, []);

  const metaOf = useCallback(
    (id: number): WBSpeaker =>
      speakers.find((s) => s.id === id) ?? {
        id,
        color: colorForSpk(id),
        av: '?',
      },
    [speakers]
  );
  const colorOf = useCallback((id: number) => metaOf(id).color, [metaOf]);
  const avOf = useCallback((id: number) => metaOf(id).av, [metaOf]);
  const displayName = useCallback(
    (id: number) => (names[id] && names[id].trim()) || `spk_${id}`,
    [names]
  );
  const isNamed = useCallback(
    (id: number) => !!(names[id] && names[id].trim()),
    [names]
  );
  const namedCount = speakers.filter((s) => isNamed(s.id)).length;

  const nameSpeaker = useCallback(
    (id: number, v: string) => {
      setNames((n) => ({ ...n, [id]: v }));
      touch();
    },
    [touch]
  );

  // 発言の話者を付け替え（lowConf を解除）。
  const reassign = useCallback(
    (turnId: string, spkId: number) => {
      setTurns((ts) =>
        ts.map((t) =>
          t.id === turnId ? { ...t, spk: spkId, lowConf: false } : t
        )
      );
      touch();
    },
    [touch]
  );

  // 話者を1名追加（誤って1人が分割されていた時の受け皿）。
  const addSpeaker = useCallback(() => {
    setSpeakers((s) => {
      const used = s.map((x) => x.id);
      let id = 0;
      while (used.includes(id)) id++;
      return [
        ...s,
        {
          id,
          color: SPK_COLORS[id % SPK_COLORS.length],
          av: String(s.length + 1),
        },
      ];
    });
    touch();
  }, [touch]);

  // 話者を統合（fromId の全発言を intoId へ付け替え、from を消す）。
  const mergeSpeaker = useCallback(
    (fromId: number, intoId: number) => {
      if (fromId === intoId) return;
      setTurns((ts) =>
        ts.map((t) => (t.spk === fromId ? { ...t, spk: intoId } : t))
      );
      setSpeakers((s) => s.filter((x) => x.id !== fromId));
      setNames((n) => {
        const c = { ...n };
        delete c[fromId];
        return c;
      });
      touch();
    },
    [touch]
  );

  const endAtOf = (i: number, ts: WBTurn[]): number =>
    ts[i + 1] ? ts[i + 1].at : ts[i].at + 30;

  // 発話を2つに分割（時刻は文字数比で按分。後半は est:true）。
  const splitTurn = useCallback(
    (turnId: string) => {
      setTurns((ts) => {
        const i = ts.findIndex((t) => t.id === turnId);
        if (i < 0) return ts;
        const t = ts[i];
        const txt = plainText(t.html);
        const mid = Math.max(1, Math.floor(txt.length / 2));
        const end = endAtOf(i, ts);
        const midAt = Math.round(
          t.at + (end - t.at) * (mid / Math.max(1, txt.length))
        );
        const t1: WBTurn = { ...t, html: txt.slice(0, mid) };
        const t2: WBTurn = {
          ...t,
          id: `x${Date.now()}`,
          html: txt.slice(mid),
          at: midAt,
          t: fmtTime(midAt),
          lowConf: false,
          est: true,
        };
        const out = [...ts];
        out.splice(i, 1, t1, t2);
        return out;
      });
      touch();
    },
    [touch]
  );

  // 次の発話と結合（時刻は先頭側を採用＝範囲を結合）。
  const mergeWithNext = useCallback(
    (turnId: string) => {
      setTurns((ts) => {
        const i = ts.findIndex((t) => t.id === turnId);
        if (i < 0 || i >= ts.length - 1) return ts;
        const a = ts[i];
        const b = ts[i + 1];
        const merged: WBTurn = {
          ...a,
          html: plainText(a.html) + ' ' + plainText(b.html),
        };
        const out = [...ts];
        out.splice(i, 2, merged);
        return out;
      });
      touch();
    },
    [touch]
  );

  // 手動で発話を追加（時刻は隣の境界を継承＝目安）。
  const addTurnAfter = useCallback(
    (turnId: string) => {
      setTurns((ts) => {
        const i = ts.findIndex((t) => t.id === turnId);
        if (i < 0) return ts;
        const at = endAtOf(i, ts);
        const nt: WBTurn = {
          id: `x${Date.now()}`,
          spk: ts[i].spk,
          at,
          t: fmtTime(at),
          html: '',
          manual: true,
        };
        const out = [...ts];
        out.splice(i + 1, 0, nt);
        return out;
      });
      touch();
    },
    [touch]
  );

  const deleteTurn = useCallback(
    (turnId: string) => {
      setTurns((ts) => ts.filter((t) => t.id !== turnId));
      touch();
    },
    [touch]
  );

  // 本文の手編集を反映（contentEditable の blur で確定）。無変更なら touch しない。
  const editTurnHtml = useCallback(
    (turnId: string, html: string) => {
      let changed = false;
      setTurns((ts) =>
        ts.map((t) => {
          if (t.id === turnId && t.html !== html) {
            changed = true;
            return { ...t, html };
          }
          return t;
        })
      );
      if (changed) touch();
    },
    [touch]
  );

  const lowConfTurns = turns.filter((t) => t.lowConf);
  const lowConfCount = lowConfTurns.length;
  // 要確認を順送り（現在地より後の最初の要確認へ。なければ先頭へ）。
  const gotoNextLowConf = useCallback(() => {
    if (!lowConfTurns.length) return null;
    const ai = turns.findIndex((t) => t.id === active);
    const next =
      lowConfTurns.find((t) => turns.findIndex((x) => x.id === t.id) > ai) ||
      lowConfTurns[0];
    setActive(next.id);
    return next.id;
  }, [lowConfTurns, turns, active]);

  return {
    names,
    speakers,
    turns,
    active,
    setActive,
    rev,
    load,
    colorOf,
    avOf,
    displayName,
    isNamed,
    namedCount,
    nameSpeaker,
    reassign,
    addSpeaker,
    mergeSpeaker,
    splitTurn,
    mergeWithNext,
    addTurnAfter,
    deleteTurn,
    editTurnHtml,
    lowConfCount,
    gotoNextLowConf,
  };
};

export default useMEState;
