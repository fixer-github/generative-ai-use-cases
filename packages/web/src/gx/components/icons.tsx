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
