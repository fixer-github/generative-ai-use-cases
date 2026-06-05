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
