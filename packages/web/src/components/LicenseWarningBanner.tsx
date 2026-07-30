import React, { useCallback, useState } from 'react';
import { BaseProps } from '../@types/common';
import { useTranslation } from 'react-i18next';
import { PiWarningFill, PiX } from 'react-icons/pi';
import useLicense from '../hooks/useLicense';

// localStorage key for "shown once per month" (requirement 25).
// A new key is used every month, so the banner shows again after the reset.
const dismissedKey = () => {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `licenseWarnBannerClosed:${month}`;
};

// Warning banner shown when the remaining allowance falls below the
// critical threshold (requirement 25).
const LicenseWarningBanner: React.FC<BaseProps> = (props) => {
  const { t } = useTranslation();
  const { license, warnLevel } = useLicense();
  // State only exists to trigger a re-render on close; localStorage is the
  // source of truth so the banner stays hidden across page loads.
  const [, setClosedAt] = useState(0);

  const onClose = useCallback(() => {
    try {
      localStorage.setItem(dismissedKey(), new Date().toISOString());
    } catch (e) {
      console.error('Failed to persist license banner dismissal:', e);
    }
    setClosedAt(Date.now());
  }, []);

  if (!license || warnLevel !== 'critical') {
    return null;
  }

  let dismissed = false;
  try {
    dismissed = localStorage.getItem(dismissedKey()) !== null;
  } catch (e) {
    // Ignore storage errors (e.g. privacy mode) and show the banner
    console.error('Failed to read license banner dismissal:', e);
  }
  if (dismissed) {
    return null;
  }

  return (
    <div
      role="alert"
      className={`${props.className ?? ''} mx-auto my-2 flex w-fit max-w-3xl items-center gap-2 rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-900`}>
      <PiWarningFill className="shrink-0" />
      <span>
        {t('license.banner.critical', {
          percent: license.criticalThresholdPercent,
          resetDate: license.resetDate,
        })}
      </span>
      <button
        type="button"
        aria-label={t('common.close')}
        className="shrink-0 rounded p-0.5 hover:bg-red-100"
        onClick={onClose}>
        <PiX />
      </button>
    </div>
  );
};

export default LicenseWarningBanner;
