import * as React from 'react';
import { cn } from '@/lib/utils';

type SkillLogoSize = 'sm' | 'md' | 'lg';

interface SkillLogoProps {
  logoId: string;
  label: string;
  size?: SkillLogoSize;
  className?: string;
}

const SIZE_CLASS: Record<SkillLogoSize, string> = {
  sm: 'h-6 w-6 rounded-[7px]',
  md: 'h-9 w-9 rounded-[10px]',
  lg: 'h-14 w-14 rounded-[14px]',
};

const KNOWN_LOGOS = new Set([
  'douyin-live-ops',
  'xiaohongshu-seeding-ops',
  'wechat-article-ops',
  'social-media-strategy',
  'image-prompt-reverse',
  'a-share-market-briefing',
  'contract-risk-review',
  'market-competitor-insight',
  'data-report-insight',
  'product-plan-drafting',
  'project-delivery-management',
  'resume-search-screening',
  'performance-review-design',
]);

export function SkillLogo({
  logoId,
  label,
  size = 'md',
  className,
}: SkillLogoProps): JSX.Element {
  const known = KNOWN_LOGOS.has(logoId);
  const theme = logoTheme(known ? logoId : 'fallback');

  return (
    <span
      role="img"
      aria-label={label}
      data-logo-id={logoId}
      data-logo-known={known ? 'true' : 'false'}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/80 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_6px_16px_rgba(234,31,89,0.055)]',
        SIZE_CLASS[size],
        className,
      )}
      style={{ background: theme.background, color: theme.foreground }}
    >
      <span
        aria-hidden
        className="absolute inset-0 opacity-95"
        style={{ background: theme.overlay }}
      />
      <svg
        aria-hidden
        viewBox="0 0 48 48"
        className="relative h-[72%] w-[72%] drop-shadow-[0_1px_1px_rgba(15,23,42,0.10)]"
      >
        {logoMark(known ? logoId : 'fallback', theme.accent)}
      </svg>
    </span>
  );
}

function logoTheme(logoId: string): {
  background: string;
  overlay: string;
  foreground: string;
  accent: string;
} {
  switch (logoId) {
    case 'douyin-live-ops':
      return {
        background: '#66D9F7',
        overlay: 'linear-gradient(135deg, rgba(102,217,247,0.96), rgba(255,112,158,0.88))',
        foreground: '#FFFFFF',
        accent: '#BEEFFF',
      };
    case 'xiaohongshu-seeding-ops':
      return {
        background: '#FF7EA1',
        overlay: 'radial-gradient(circle at 28% 22%, rgba(255,255,255,0.94), rgba(255,255,255,0) 42%)',
        foreground: '#FFFFFF',
        accent: '#FFE6EF',
      };
    case 'wechat-article-ops':
      return {
        background: '#63DFA6',
        overlay: 'linear-gradient(160deg, rgba(255,255,255,0.36), rgba(37,178,116,0.16))',
        foreground: '#FFFFFF',
        accent: '#E5FFF1',
      };
    case 'social-media-strategy':
      return {
        background: '#B5A6FF',
        overlay: 'radial-gradient(circle at 72% 22%, rgba(255,221,95,0.95), rgba(255,221,95,0) 42%)',
        foreground: '#FFFFFF',
        accent: '#FFE27A',
      };
    case 'image-prompt-reverse':
      return {
        background: '#83D7FF',
        overlay: 'linear-gradient(135deg, rgba(131,215,255,0.94), rgba(255,224,111,0.8))',
        foreground: '#FFFFFF',
        accent: '#FFFFFF',
      };
    case 'a-share-market-briefing':
      return {
        background: '#FF7A8D',
        overlay: 'linear-gradient(145deg, rgba(255,255,255,0.3), rgba(255,119,152,0.18))',
        foreground: '#FFFFFF',
        accent: '#E0F7FF',
      };
    case 'contract-risk-review':
      return {
        background: '#A8B7FF',
        overlay: 'linear-gradient(145deg, rgba(255,255,255,0.28), rgba(255,126,161,0.22))',
        foreground: '#FFFFFF',
        accent: '#FFE3EC',
      };
    case 'market-competitor-insight':
      return {
        background: '#62D7C7',
        overlay: 'radial-gradient(circle at 24% 22%, rgba(255,225,117,0.92), rgba(255,225,117,0) 40%)',
        foreground: '#FFFFFF',
        accent: '#FFE175',
      };
    case 'data-report-insight':
      return {
        background: '#7DBBFF',
        overlay: 'linear-gradient(150deg, rgba(255,255,255,0.24), rgba(111,225,164,0.45))',
        foreground: '#FFFFFF',
        accent: '#E7FFF1',
      };
    case 'product-plan-drafting':
      return {
        background: '#AFA8FF',
        overlay: 'radial-gradient(circle at 76% 24%, rgba(190,232,255,0.96), rgba(190,232,255,0) 40%)',
        foreground: '#FFFFFF',
        accent: '#E8E5FF',
      };
    case 'project-delivery-management':
      return {
        background: '#FFBA72',
        overlay: 'linear-gradient(135deg, rgba(255,255,255,0.28), rgba(255,226,122,0.5))',
        foreground: '#FFFFFF',
        accent: '#FFF4B8',
      };
    case 'resume-search-screening':
      return {
        background: '#78DDF6',
        overlay: 'linear-gradient(140deg, rgba(255,255,255,0.26), rgba(181,166,255,0.34))',
        foreground: '#FFFFFF',
        accent: '#E2FAFF',
      };
    case 'performance-review-design':
      return {
        background: '#FF8BC4',
        overlay: 'radial-gradient(circle at 70% 22%, rgba(255,255,255,0.42), rgba(255,255,255,0) 42%)',
        foreground: '#FFFFFF',
        accent: '#FFE2F0',
      };
    default:
      return {
        background: '#B9C7D6',
        overlay: 'linear-gradient(145deg, rgba(255,255,255,0.28), rgba(125,187,255,0.2))',
        foreground: '#FFFFFF',
        accent: '#EEF5FF',
      };
  }
}

function logoMark(logoId: string, accent: string): React.ReactNode {
  switch (logoId) {
    case 'douyin-live-ops':
      return (
        <>
          <path d="M18 13v22l17-11L18 13Z" fill="currentColor" />
          <path d="M33 14c3 3 4.5 6.5 4.5 10s-1.5 7-4.5 10" fill="none" stroke={accent} strokeLinecap="round" strokeWidth="4" />
          <path d="M11 18c-2 4-2 8 0 12" fill="none" stroke="#EA1F59" strokeLinecap="round" strokeWidth="4" />
        </>
      );
    case 'xiaohongshu-seeding-ops':
      return (
        <>
          <rect x="12" y="10" width="24" height="29" rx="5" fill="currentColor" />
          <path d="M18 17h12M18 23h9M18 29h7" stroke="#F72B4E" strokeLinecap="round" strokeWidth="3" />
          <path d="M31 29c4-1 6-4 6-8-4 1-7 4-6 8Z" fill={accent} />
        </>
      );
    case 'wechat-article-ops':
      return (
        <>
          <path d="M11 17c0-5 5-9 12-9s12 4 12 9-5 9-12 9h-3l-6 5 1.5-6C12.7 23.3 11 20.4 11 17Z" fill="currentColor" />
          <path d="M19 17h10M19 22h7" stroke="#21B26B" strokeLinecap="round" strokeWidth="3" />
          <circle cx="33" cy="31" r="6" fill={accent} />
        </>
      );
    case 'social-media-strategy':
      return (
        <>
          <path d="M15 17l10 7 8-9M15 31l10-7 9 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
          <circle cx="13" cy="17" r="5" fill="currentColor" />
          <circle cx="25" cy="24" r="5" fill={accent} />
          <circle cx="35" cy="15" r="5" fill="currentColor" />
          <circle cx="36" cy="32" r="5" fill="currentColor" />
        </>
      );
    case 'image-prompt-reverse':
      return (
        <>
          <rect x="10" y="12" width="28" height="24" rx="5" fill="none" stroke="currentColor" strokeWidth="4" />
          <path d="M15 30l7-7 5 5 4-4 5 6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
          <path d="M34 11v8h-8" fill="none" stroke={accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
        </>
      );
    case 'a-share-market-briefing':
      return (
        <>
          <path d="M9 32h30" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
          <path d="M12 29l7-9 7 5 10-13" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
          <rect x="16" y="12" width="4" height="14" rx="2" fill={accent} />
          <rect x="29" y="16" width="4" height="16" rx="2" fill={accent} />
        </>
      );
    case 'contract-risk-review':
      return (
        <>
          <path d="M15 8h14l6 6v26H15V8Z" fill="currentColor" />
          <path d="M29 8v7h7" fill="none" stroke="#2F3A4A" strokeWidth="3" />
          <path d="M24 22l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9v-6l8-3Z" fill={accent} />
        </>
      );
    case 'market-competitor-insight':
      return (
        <>
          <circle cx="21" cy="21" r="10" fill="none" stroke="currentColor" strokeWidth="4" />
          <path d="M29 29l8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="5" />
          <path d="M16 22h10M21 17v10" stroke={accent} strokeLinecap="round" strokeWidth="3" />
        </>
      );
    case 'data-report-insight':
      return (
        <>
          <rect x="10" y="10" width="28" height="28" rx="5" fill="currentColor" opacity="0.96" />
          <path d="M18 31V20M24 31V16M30 31v-7" stroke="#2563EB" strokeLinecap="round" strokeWidth="4" />
          <circle cx="31" cy="17" r="4" fill={accent} />
        </>
      );
    case 'product-plan-drafting':
      return (
        <>
          <rect x="10" y="12" width="12" height="10" rx="3" fill="currentColor" />
          <rect x="26" y="12" width="12" height="10" rx="3" fill={accent} />
          <rect x="10" y="27" width="28" height="10" rx="3" fill="currentColor" />
        </>
      );
    case 'project-delivery-management':
      return (
        <>
          <path d="M12 31c8-14 18-14 24-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
          <circle cx="13" cy="31" r="5" fill="currentColor" />
          <circle cx="24" cy="22" r="5" fill={accent} />
          <circle cx="36" cy="27" r="5" fill="currentColor" />
        </>
      );
    case 'resume-search-screening':
      return (
        <>
          <rect x="11" y="9" width="23" height="30" rx="5" fill="currentColor" />
          <circle cx="22" cy="20" r="5" fill="#0891B2" />
          <path d="M16 31c2-4 10-4 12 0" fill="none" stroke="#0891B2" strokeLinecap="round" strokeWidth="3" />
          <path d="M32 30l6 6" stroke={accent} strokeLinecap="round" strokeWidth="4" />
          <circle cx="30" cy="28" r="5" fill="none" stroke={accent} strokeWidth="3" />
        </>
      );
    case 'performance-review-design':
      return (
        <>
          <circle cx="24" cy="24" r="14" fill="none" stroke="currentColor" strokeWidth="4" />
          <circle cx="24" cy="24" r="7" fill="none" stroke={accent} strokeWidth="4" />
          <circle cx="24" cy="24" r="3" fill="currentColor" />
          <path d="M24 8v6M24 34v6M8 24h6M34 24h6" stroke={accent} strokeLinecap="round" strokeWidth="3" />
        </>
      );
    default:
      return (
        <>
          <rect x="13" y="13" width="22" height="22" rx="6" fill="currentColor" />
          <path d="M19 24h10M24 19v10" stroke="#6B7280" strokeLinecap="round" strokeWidth="4" />
        </>
      );
  }
}
