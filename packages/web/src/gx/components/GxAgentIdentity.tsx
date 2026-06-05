/**
 * GxAgentIdentity — エージェントの識別子の塊（移植規約ドラフト 3.2(3)）。
 *
 * 「角丸アイコン枠（system はグラデ背景）＋名前＋公式/院内バッジ＋作成者」。
 * トップ提案カード／エージェント一覧の大カード／スケジューラ行で繰り返される
 * ため共有化。GxOriginBadge((2)) を内包する。
 *
 * アイコンは現状、供給源（公式 AgentCore は name/description/arn のみの薄い型）
 * から個別アイコンを持てないため、共通のエージェント・グリフ（IcAgent）を使う。
 * 将来 cdk 設定にアイコン指定を足したらここで出し分ける。
 */
import React from 'react';
import { IcAgent } from './icons';
import GxOriginBadge from './GxOriginBadge';

type Props = {
  name: string;
  creator?: string;
  origin: 'system' | 'user';
  /** アイコン枠のサイズ（px）。既定 44（大カード）。rail等で縮める用 */
  iconSize?: number;
};

const GxAgentIdentity: React.FC<Props> = ({
  name,
  creator,
  origin,
  iconSize = 44,
}) => {
  const isSystem = origin === 'system';
  return (
    <div className="gx-agent-id">
      <div
        className={'gx-agent-id__icon ' + (isSystem ? 'is-system' : 'is-user')}
        style={{ width: iconSize, height: iconSize, flexBasis: iconSize }}>
        <IcAgent size={Math.round(iconSize * 0.52)} />
      </div>
      <div className="gx-agent-id__main">
        <div className="gx-agent-id__name">
          <span className="gx-agent-id__nm">{name}</span>
          <GxOriginBadge origin={origin} />
        </div>
        {creator && <div className="gx-agent-id__creator">{creator}</div>}
      </div>
    </div>
  );
};

export default GxAgentIdentity;
