/**
 * 新UI用のモノラインアイコン群。
 * デザインバンドル project/app/icons.jsx を TSX へ移植（必要分のみ）。
 * 24×24 viewBox / currentColor / strokeWidth 1.6 / round caps。
 */
import React from 'react';

type IconProps = { size?: number } & React.SVGProps<SVGSVGElement>;

const Svg: React.FC<IconProps & { children: React.ReactNode }> = ({
  size = 24,
  children,
  ...props
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}>
    {children}
  </svg>
);

export const IcChat: React.FC<IconProps> = ({ size = 16, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 5h16v11H9l-4 3.5V5z" />
  </Svg>
);

export const IcAgent: React.FC<IconProps> = ({ size = 16, ...p }) => (
  <Svg size={size} {...p}>
    <rect x="5" y="7" width="14" height="11" rx="2.5" />
    <circle cx="9.5" cy="12.5" r="1.2" />
    <circle cx="14.5" cy="12.5" r="1.2" />
    <path d="M12 4v3" />
    <path d="M3 13h2M19 13h2" />
  </Svg>
);

export const IcMinutes: React.FC<IconProps> = ({ size = 16, ...p }) => (
  <Svg size={size} {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <path d="M7 8h10M7 11h10M7 14h7" />
    <path d="m14 18 2 2 4-4" />
  </Svg>
);

export const IcScheduler: React.FC<IconProps> = ({ size = 16, ...p }) => (
  <Svg size={size} {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </Svg>
);

export const IcAdmin: React.FC<IconProps> = ({ size = 16, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M12 3.5 4.5 6.5v5.5c0 4 3.5 7 7.5 8.5 4-1.5 7.5-4.5 7.5-8.5V6.5z" />
    <path d="m9 12.5 2 2 4-4" />
  </Svg>
);

export const IcSearch: React.FC<IconProps> = ({ size = 12, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4-4" />
  </Svg>
);

export const IcGear: React.FC<IconProps> = ({ size = 14, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.5 12c0-.5-.05-1-.13-1.5l2.13-1.6-2-3.4-2.5 1c-.8-.6-1.7-1.1-2.6-1.4L13.5 2h-3l-.4 3.1c-.9.3-1.8.8-2.6 1.4l-2.5-1-2 3.4 2.13 1.6c-.08.5-.13 1-.13 1.5s.05 1 .13 1.5L2 15.5l2 3.4 2.5-1c.8.6 1.7 1.1 2.6 1.4l.4 3.1h3l.4-3.1c.9-.3 1.8-.8 2.6-1.4l2.5 1 2-3.4-2.13-1.6c.08-.5.13-1 .13-1.5z" />
  </Svg>
);

export const IcPlus: React.FC<IconProps> = ({ size = 15, ...p }) => (
  <Svg size={size} strokeWidth={2.2} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IcFiles: React.FC<IconProps> = ({ size = 16, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);

export const IcPaperclip: React.FC<IconProps> = ({ size = 18, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17a1.5 1.5 0 0 1-2-2l7.5-7.5" />
  </Svg>
);

// 音声入力（Transcribe）トグル用のマイク。
export const IcMic: React.FC<IconProps> = ({ size = 18, ...p }) => (
  <Svg size={size} {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3M9 21h6" />
  </Svg>
);

export const IcSend: React.FC<IconProps> = ({ size = 17, ...p }) => (
  <Svg size={size} strokeWidth={2} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

// 生成中の停止ボタン用（塗りの角丸スクエア）
export const IcStop: React.FC<IconProps> = ({ size = 14, ...p }) => (
  <Svg size={size} fill="currentColor" stroke="none" {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </Svg>
);

export const IcClose: React.FC<IconProps> = ({ size = 14, ...p }) => (
  <Svg size={size} strokeWidth={2} {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const IcUser: React.FC<IconProps> = ({ size = 16, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </Svg>
);

export const IcRetry: React.FC<IconProps> = ({ size = 15, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M20 11a8 8 0 1 0-.9 4.6" />
    <path d="M20 5v6h-6" />
  </Svg>
);

// きらめき（エージェント一覧のeyebrow等）。プロト ScSpark の移植。
export const IcSpark: React.FC<IconProps> = ({ size = 14, ...p }) => (
  <Svg size={size} {...p}>
    <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" />
  </Svg>
);

// 汎用の右矢印（シーンカードCTA「このシーンではじめる」等）。プロト ScArrowRight。
export const IcArrowRight: React.FC<IconProps> = ({ size = 14, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

// 所要時間チップ用の時計（シーンカード corner-time）。プロト ScClock。
export const IcClock: React.FC<IconProps> = ({ size = 14, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

// ファイル入口の「アップロード」グリフ（議事録 方法選択 MChoose のファイルカード）。
export const IcUpload: React.FC<IconProps> = ({ size = 26, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Svg>
);

// 特長リストのチェック（MChoose の feature 行）。
export const IcCheck: React.FC<IconProps> = ({ size = 11, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M5 13l4 4L19 7" />
  </Svg>
);

// 戻る（議事録 録音/ファイル画面ヘッダの「方法選択に戻る」）。プロト me-iconbtn の chevron。
export const IcBack: React.FC<IconProps> = ({ size = 15, ...p }) => (
  <Svg size={size} strokeWidth={1.9} {...p}>
    <path d="m15 6-6 6 6 6" />
  </Svg>
);

// 一時停止（録音中の「一時停止」ボタン）。プロト MRecording の二本線。
export const IcPause: React.FC<IconProps> = ({ size = 14, ...p }) => (
  <Svg size={size} strokeWidth={2} {...p}>
    <path d="M8 5v14M16 5v14" />
  </Svg>
);

// 目印（録音中のブックマーク）。プロト MRecording の塗りペナント。
export const IcBookmark: React.FC<IconProps> = ({ size = 14, ...p }) => (
  <Svg size={size} fill="currentColor" stroke="none" {...p}>
    <path d="M6 4h12v17l-6-4-6 4z" />
  </Svg>
);

// 補足（録音中の注記・ファイル処理中の注意）。プロト共通の i 丸アイコン。
export const IcInfo: React.FC<IconProps> = ({ size = 15, ...p }) => (
  <Svg size={size} strokeWidth={1.8} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);

// 音声/動画ファイル（ファイル入口の選択済みファイル行）。プロト me2-file の波形バー。
export const IcFileAudio: React.FC<IconProps> = ({ size = 18, ...p }) => (
  <Svg size={size} strokeWidth={2} {...p}>
    <path d="M4 14V10M8 18V6M12 16V8M16 20V4M20 13v-2" />
  </Svg>
);

// 文字起こしを開始（行リスト風）。プロト MEntryFile の primary ボタン。
export const IcTranscribe: React.FC<IconProps> = ({ size = 16, ...p }) => (
  <Svg size={size} strokeWidth={2} {...p}>
    <path d="M5 6h11M5 10h14M5 14h9M5 18h12" />
  </Svg>
);

// 再生成/処理中（リフレッシュ矢印）。ファイル処理中バナー・議事録の再生成で共用。
export const IcRefresh: React.FC<IconProps> = ({ size = 14, ...p }) => (
  <Svg size={size} strokeWidth={1.8} {...p}>
    <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    <path d="M21 4v5h-5" />
  </Svg>
);

// 議事録ワークベンチ用（MEditA / MEShared 由来・step 5）
export const IcSplit: React.FC<IconProps> = ({ size = 13, ...p }) => (
  <Svg size={size} strokeWidth={1.8} {...p}>
    <path d="M8 3v18M3 8h5M3 16h5" />
    <path d="M16 8h5M16 16h5M16 3v18" />
  </Svg>
);

export const IcMerge: React.FC<IconProps> = ({ size = 13, ...p }) => (
  <Svg size={size} strokeWidth={1.8} {...p}>
    <path d="M7 8l5 4-5 4M17 8l-5 4 5 4" />
  </Svg>
);

export const IcTrash: React.FC<IconProps> = ({ size = 13, ...p }) => (
  <Svg size={size} strokeWidth={1.8} {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </Svg>
);

export const IcDots: React.FC<IconProps> = ({ size = 15, ...p }) => (
  <Svg size={size} fill="currentColor" stroke="none" {...p}>
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </Svg>
);

export const IcLink: React.FC<IconProps> = ({ size = 11, ...p }) => (
  <Svg size={size} strokeWidth={1.7} {...p}>
    <path d="M9 14l6-6" />
    <rect x="3" y="11" width="7" height="7" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
  </Svg>
);

export const IcAlert: React.FC<IconProps> = ({ size = 17, ...p }) => (
  <Svg size={size} strokeWidth={1.8} {...p}>
    <path d="M12 3l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </Svg>
);

export const IcChevronDown: React.FC<IconProps> = ({ size = 11, ...p }) => (
  <Svg size={size} strokeWidth={2} {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

/* ===========================================================================
   シーン用の装飾アイコン（Sc*）— トップ Bento のシーンカード／クイックボタン用。
   プロト icons.jsx のシーンアイコンを忠実に移植（医療文脈のモノライン）。
   chrome 系（Ic*）と区別するため Sc プレフィックスを温存する（移植規約 §3.2(8)）。
   ============================================================================ */

// 患者・家族向け
export const ScPatientExplain: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M5 4h11l3 3v13H5z" />
    <path d="M15 4v3.5h3" />
    <path d="M8.5 12c1-1.4 2.2-2 3.5-2s2.5.6 3.5 2" />
    <circle cx="9.5" cy="16" r="0.8" fill="currentColor" />
    <circle cx="14.5" cy="16" r="0.8" fill="currentColor" />
  </Svg>
);

export const ScDischarge: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M5 4h7v16H5z" />
    <path d="M12 12h8M16 8l4 4-4 4" />
    <circle cx="9" cy="12" r="0.7" fill="currentColor" />
  </Svg>
);

export const ScResultExplain: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
    <path d="M7 11h2l1-2 2 4 1-2h2" />
  </Svg>
);

// 会議・引き継ぎ
export const ScHandover: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <rect x="8" y="6" width="8" height="6" rx="0.8" />
    <path d="M4 14c0-1.5 1-2.5 2.5-2.5h3" />
    <path d="M20 14c0-1.5-1-2.5-2.5-2.5h-3" />
    <path d="M6 18c1-1 3-1.5 6-1.5s5 .5 6 1.5" />
  </Svg>
);

export const ScCommittee: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <rect x="5" y="4.5" width="14" height="16" rx="1.5" />
    <path d="M9 3.5h6v3H9z" />
    <path d="m8.5 11 1.2 1.2L12 9.5" />
    <path d="m8.5 15 1.2 1.2L12 13.5" />
    <path d="M14 11h3M14 15h3" />
  </Svg>
);

// 臨床・調査
export const ScGuideline: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 4.5h11a3 3 0 0 1 3 3V20H7a3 3 0 0 1-3-3z" />
    <path d="M4 17.5a3 3 0 0 1 3-3h11" />
    <path d="M12 4.5V11l2-1.5L16 11V4.5" />
  </Svg>
);

export const ScPaperSummary: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M7 6h10v14H7z" />
    <path d="M9.5 3.5h10v14" />
    <path d="M9.5 10h5M9.5 13h5M9.5 16h3.5" />
  </Svg>
);

export const ScTranslate: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 14 6 5l3 9M4 11h4" />
    <path d="M11 11h3.5" />
    <path d="M15 7c1.5 0 3 1 3 3 0 3-3 4-3 7M18 17c1 0 2-.5 2-1.5" />
  </Svg>
);

// 院内文書・事務
export const ScNotice: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 10v4l11 4V6z" />
    <path d="M15 9c1.5.6 1.5 5.4 0 6" />
    <path d="M8 18v2H6v-2" />
  </Svg>
);

export const ScManual: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <rect x="4.5" y="4.5" width="15" height="15" rx="1" />
    <path d="M8 4.5v15" />
    <circle cx="13" cy="8.5" r="0.8" fill="currentColor" />
    <circle cx="13" cy="12" r="0.8" fill="currentColor" />
    <circle cx="13" cy="15.5" r="0.8" fill="currentColor" />
    <path d="M14.5 8.5h3M14.5 12h3M14.5 15.5h2.5" />
  </Svg>
);

export const ScForm: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M5 4.5h11l3 3v13H5z" />
    <path d="M15 4.5V8h3.5" />
    <path d="M8 12h5M8 15h7" />
    <path d="m15 19 4-4 1.5 1.5-4 4H15z" />
  </Svg>
);

// 研修・教育
export const ScTraining: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 9.5 12 5l9 4.5L12 14z" />
    <path d="M7 11.5v3.5c0 1.5 2.5 2.5 5 2.5s5-1 5-2.5v-3.5" />
    <path d="M20 10v5" />
  </Svg>
);

export const ScStudy: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 6c2.5-1 5.5-1 8 0 2.5-1 5.5-1 8 0v12c-2.5-1-5.5-1-8 0-2.5-1-5.5-1-8 0z" />
    <path d="M12 6v12" />
  </Svg>
);

// 可視化・音声（テキスト系として残すのは FAQ のみ）
export const ScFAQ: React.FC<IconProps> = ({ size = 24, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 5h16v11H9l-4 3.5V5z" />
    <path d="M10 9c0-1 1-2 2-2s2 1 2 2-2 1.2-2 3" />
    <circle cx="12" cy="14" r="0.8" fill="currentColor" />
  </Svg>
);
