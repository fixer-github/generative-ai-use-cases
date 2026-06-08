/**
 * GxMinutesPage — 議事録ワークベンチの入口「方法を選ぶ」（Phase 2 / step 3a）。
 *
 * 着工方針：`Phase2_議事録ワークベンチ_着工方針メモ.md`。デザインバンドル
 * project/app/MChoose.jsx の移植。歓迎の演出はこの1画面に集約し、各モード
 * （録音 / ファイル）の専用ページでは繰り返さない（プロトの設計意図）。
 *
 * 仕分け（移植規約 1.3）：純粋な (a) 新規UI型。ロジックは「どちらの入口へ遷移するか」
 * のみ。録音（useMicrophone）・ファイル（useTranscribe/useTranscribeApi）の結線と
 * 会議作成（useMeetingApi）は後続増分（step 3b/3c）で各モードページに置く。
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { IcMic, IcUpload, IcCheck, IcArrowRight } from '../components/icons';
import { GX } from '../strings';
import '../styles/minutes.css';

const M = GX.minutes.choose;

const GxMinutesPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="gx-mch">
      <div className="gx-mch__wrap">
        <div className="gx-mch__eyebrow">
          <span className="badge">{M.eyebrowBadge}</span>
          <span>{M.eyebrowText}</span>
        </div>
        <h1 className="gx-mch__h1">
          {M.titleLead}
          <span className="grad">{M.titleEmphasis}</span>
          {M.titleTrail}
        </h1>
        <p className="gx-mch__sub">{M.sub}</p>

        <div className="gx-mch__cards">
          {/* ライブ（その場で文字起こし） */}
          <button
            className="gx-mch__card"
            onClick={() => navigate('/g/minutes/record')}>
            <div className="gx-mch__ic live">
              <IcMic size={26} />
            </div>
            <div className="gx-mch__ttl-row">
              <h2>{M.liveTitle}</h2>
              <span className="gx-mch__tag live">{M.liveTag}</span>
            </div>
            <p>{M.liveDesc}</p>
            <ul className="gx-mch__feat">
              <li>
                <span className="gx-mch__ck">
                  <IcCheck />
                </span>
                {M.liveFeat1}
              </li>
              <li>
                <span className="gx-mch__ck">
                  <IcCheck />
                </span>
                {M.liveFeat2}
              </li>
            </ul>
            <span className="gx-mch__go">
              {M.liveGo}
              <IcArrowRight size={16} />
            </span>
          </button>

          {/* ファイルから文字起こし */}
          <button
            className="gx-mch__card"
            onClick={() => navigate('/g/minutes/file')}>
            <div className="gx-mch__ic file">
              <IcUpload size={26} />
            </div>
            <div className="gx-mch__ttl-row">
              <h2>{M.fileTitle}</h2>
              <span className="gx-mch__tag file">{M.fileTag}</span>
            </div>
            <p>{M.fileDesc}</p>
            <ul className="gx-mch__feat">
              <li>
                <span className="gx-mch__ck">
                  <IcCheck />
                </span>
                {M.fileFeat1}
              </li>
              <li>
                <span className="gx-mch__ck">
                  <IcCheck />
                </span>
                {M.fileFeat2}
              </li>
            </ul>
            <span className="gx-mch__go">
              {M.fileGo}
              <IcArrowRight size={16} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default GxMinutesPage;
