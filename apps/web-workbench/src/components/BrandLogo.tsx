import * as React from 'react';
import { cn } from '@/lib/utils';

const LOGO_BASE_URL = 'https://assets.holaday.ai/logo';

export const BRAND_ASSETS = {
  hdSingle: `${LOGO_BASE_URL}/HD-single-logo.png`,
  hdLogoBlack: `${LOGO_BASE_URL}/HD-logo-black.png`,
  hdLogoWhite: `${LOGO_BASE_URL}/HD-logo-white.png`,
  textBlack: `${LOGO_BASE_URL}/HOLA-DAY-text-black.png`,
  textWhite: `${LOGO_BASE_URL}/HOLA-DAY-text-white.png`,
} as const;

interface BrandImageProps {
  className?: string;
}

export function BrandIcon({ className }: BrandImageProps): JSX.Element {
  const [failed, setFailed] = React.useState(false);

  if (failed) {
    return (
      <span
        aria-label="HOLA DAY"
        className={cn(
          'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground',
          className
        )}
      >
        HD
      </span>
    );
  }

  return (
    <img
      src={BRAND_ASSETS.hdSingle}
      alt="HOLA DAY"
      className={cn('block h-7 w-auto max-w-[48px] shrink-0 object-contain', className)}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}

export function BrandWordmark({ className }: BrandImageProps): JSX.Element {
  const [failed, setFailed] = React.useState(false);

  if (failed) {
    return (
      <span className={cn('text-base font-semibold tracking-tight text-sidebar-foreground', className)}>
        HOLA DAY
      </span>
    );
  }

  return (
    <>
      <img
        src={BRAND_ASSETS.textBlack}
        alt="HOLA DAY"
        className={cn('block h-4 w-auto object-contain dark:hidden', className)}
        onError={() => setFailed(true)}
        draggable={false}
      />
      <img
        src={BRAND_ASSETS.textWhite}
        alt="HOLA DAY"
        className={cn('hidden h-4 w-auto object-contain dark:block', className)}
        onError={() => setFailed(true)}
        draggable={false}
      />
    </>
  );
}

export function FullBrandLogo({ className }: BrandImageProps): JSX.Element {
  const [failed, setFailed] = React.useState(false);

  if (failed) {
    return (
      <div className={cn('text-lg font-semibold tracking-tight text-foreground', className)}>
        HOLA DAY
      </div>
    );
  }

  return (
    <>
      <img
        src={BRAND_ASSETS.hdLogoBlack}
        alt="HOLA DAY"
        className={cn('block h-10 w-auto max-w-full object-contain dark:hidden', className)}
        onError={() => setFailed(true)}
        draggable={false}
      />
      <img
        src={BRAND_ASSETS.hdLogoWhite}
        alt="HOLA DAY"
        className={cn('hidden h-10 w-auto max-w-full object-contain dark:block', className)}
        onError={() => setFailed(true)}
        draggable={false}
      />
    </>
  );
}
