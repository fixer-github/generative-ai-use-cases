/**
 * GxPageHero — ヒーロー型ヘッダ（移植規約ドラフト 3.2(5)）。
 *
 * 「eyebrow（spark付き小ラベル）＋大見出し（グラデ強調可）＋サブ説明」。
 * トップとエージェント一覧の「探す/始める」系画面で共有する（アプリバー型
 * ＝GxAppBar とは別系統）。検索バー等の画面固有の中身は children で差し込む。
 */
import React from 'react';
import { IcSpark } from './icons';

type Props = {
  /** eyebrow のラベル（例：AI エージェント · ライブラリ） */
  eyebrow: string;
  /** 大見出し。グラデ強調したい箇所は <span className="gx-grad"> で囲む */
  title: React.ReactNode;
  /** サブ説明 */
  sub?: string;
  /** 見出し下に差し込む画面固有の内容（検索バー・例示chip等） */
  children?: React.ReactNode;
};

const GxPageHero: React.FC<Props> = ({ eyebrow, title, sub, children }) => {
  return (
    <div className="gx-hero">
      <div className="gx-hero__eyebrow">
        <span className="gx-hero__spark">
          <IcSpark size={10} />
        </span>
        {eyebrow}
      </div>
      <h1 className="gx-hero__title">{title}</h1>
      {sub && <p className="gx-hero__sub">{sub}</p>}
      {children}
    </div>
  );
};

export default GxPageHero;
