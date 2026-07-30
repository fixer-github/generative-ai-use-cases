import React from 'react';
import { useTranslation } from 'react-i18next';
import useLicense from '../hooks/useLicense';

type Props = {
  className?: string;
};

// Compact warning box shown near execute buttons on non-chat pages while the
// license blocks new requests (unassigned or exhausted). Same tone as the
// blocked panel in InputChatContent.tsx. Renders nothing while not blocked.
const LicenseBlockedNotice: React.FC<Props> = ({ className }) => {
  const { t } = useTranslation();
  const { blocked, blockReason, resetDate } = useLicense();

  if (!blocked) {
    return null;
  }

  return (
    <div
      role="alert"
      className={`flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 p-3 ${
        className ?? ''
      }`}>
      <div className="text-sm font-semibold text-red-700">
        {blockReason === 'unassigned'
          ? t('license.blocked.title_unassigned')
          : t('license.blocked.title_exhausted')}
      </div>
      <div className="text-xs text-gray-700">
        {blockReason === 'unassigned'
          ? t('license.blocked.body_unassigned')
          : t('license.blocked.body_exhausted', {
              resetDate: resetDate ?? '',
            })}
      </div>
      <div className="text-xs text-gray-500">
        {t('license.blocked.contact')}
      </div>
    </div>
  );
};

export default LicenseBlockedNotice;
