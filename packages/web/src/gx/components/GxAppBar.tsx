/**
 * GxAppBar — 作業画面（チャット・スケジューラ）用のアプリバー型ヘッダ。
 * 移植規約ドラフト 3.2(5)：ヘッダは「ヒーロー型（探す/始める）」と
 * 「アプリバー型（作業画面）」の2系統。本部品は後者。スケジューラでも再利用する。
 *
 * 左：パンくず（ルート＋現在地）。右：任意のツール群（children）。
 */
import React from 'react';

type Props = {
  /** パンくずのルートラベル（例：会話） */
  root: string;
  /** 現在地のラベル（例：会話タイトル）。未指定ならルートのみ表示 */
  current?: string;
  /** 右側のツール（モデル表示・ボタン等） */
  children?: React.ReactNode;
};

const GxAppBar: React.FC<Props> = ({ root, current, children }) => {
  return (
    <header className="gx-appbar">
      <div className="gx-appbar__crumb">
        <span className="gx-appbar__crumb-root">{root}</span>
        {current && (
          <>
            <span className="gx-appbar__crumb-sep">/</span>
            <span className="gx-appbar__crumb-current">{current}</span>
          </>
        )}
      </div>
      {children && <div className="gx-appbar__tools">{children}</div>}
    </header>
  );
};

export default GxAppBar;
