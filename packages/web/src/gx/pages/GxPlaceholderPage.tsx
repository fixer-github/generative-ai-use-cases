/**
 * Phase 0 用の共通プレースホルダ画面。
 * 新シェル（サイドバー＋ルーティング＋トークン）の動作確認のため、各ナビ先に
 * タイトルのみを表示する。実際の画面実装は Phase 1 以降。
 */
import React from 'react';
import { GX } from '../strings';

type Props = { title: string };

const GxPlaceholderPage: React.FC<Props> = ({ title }) => {
  return (
    <div className="gx-main-inner">
      <div className="gx-placeholder">
        <h1 className="gx-placeholder__title">{title}</h1>
        <span className="gx-placeholder__note">{GX.placeholder.note}</span>
      </div>
    </div>
  );
};

export default GxPlaceholderPage;
