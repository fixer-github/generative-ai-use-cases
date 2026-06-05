/**
 * GxOriginBadge — 「公式 / 院内」の2値バッジ（移植規約ドラフト 3.2(2)）。
 *
 * トップ提案・エージェント一覧・スケジューラ行で同じ意匠が出るため共有化。
 * D6 で v1 は公式のみだが、バッジ自体は残す（公式である表示）。
 * 小さな純表示コンポーネント。
 */
import React from 'react';
import { GX } from '../strings';

type Props = {
  origin: 'system' | 'user';
};

const GxOriginBadge: React.FC<Props> = ({ origin }) => {
  const isSystem = origin === 'system';
  return (
    <span className={'gx-origin-badge ' + (isSystem ? 'is-system' : 'is-user')}>
      {isSystem ? GX.agents.badgeSystem : GX.agents.badgeUser}
    </span>
  );
};

export default GxOriginBadge;
