import React from 'react';
import { BaseProps } from '../@types/common';
import ModalDialog from './ModalDialog';
import useLicense from '../hooks/useLicense';
import { useTranslation } from 'react-i18next';

type Props = BaseProps & {
  isOpen: boolean;
  onClose: () => void;
};

// Detail modal for the current user's license usage (requirement 24).
// Only percentages are shown; no raw amounts or token counts (requirement 23).
const LicenseDetailDialog: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  const { license, warnLevel } = useLicense();

  if (!license) {
    return null;
  }

  const barColor =
    warnLevel === 'critical'
      ? 'bg-red-400'
      : warnLevel === 'warn'
        ? 'bg-amber-400'
        : 'bg-aws-smile';
  const percentColor =
    warnLevel === 'critical'
      ? 'text-red-600'
      : warnLevel === 'warn'
        ? 'text-amber-600'
        : 'text-aws-font-color';

  return (
    <ModalDialog
      className={props.className}
      isOpen={props.isOpen}
      title={t('license.detail.title')}
      onClose={props.onClose}>
      <div className="flex flex-col gap-4 py-2">
        {/* Current plan */}
        <div>
          <div className="text-xs text-gray-500">{t('license.detail.plan')}</div>
          <div className="text-aws-font-color text-base font-medium">
            {license.assigned
              ? license.planName
              : t('license.admin.unassigned')}
          </div>
        </div>

        {/* Pending plan (from next month) */}
        {license.pendingPlanName && (
          <div>
            <div className="text-xs text-gray-500">
              {t('license.detail.pending_plan')}
            </div>
            <div className="text-aws-font-color text-base font-medium">
              {license.pendingPlanName}
            </div>
          </div>
        )}

        {license.assigned && (
          <>
            {/* Remaining this month */}
            <div>
              <div className="text-xs text-gray-500">
                {t('license.detail.remaining')}
              </div>
              {/* eslint-disable-next-line @shopify/jsx-no-hardcoded-content */}
              <div
                className={`text-2xl font-semibold tabular-nums ${percentColor}`}>
                {license.remainingPercent}%
              </div>
              <div
                className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-gray-200"
                role="progressbar"
                aria-valuenow={license.remainingPercent}
                aria-valuemin={0}
                aria-valuemax={100}>
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{
                    width: `${Math.min(Math.max(license.remainingPercent, 0), 100)}%`,
                  }}
                />
              </div>
            </div>

            {/* Next reset date */}
            <div>
              <div className="text-xs text-gray-500">
                {t('license.detail.reset_date')}
              </div>
              <div className="text-aws-font-color text-base font-medium tabular-nums">
                {license.resetDate}
              </div>
            </div>

            {/* Usage breakdown by category */}
            <div>
              <div className="text-xs text-gray-500">
                {t('license.detail.breakdown')}
              </div>
              {license.breakdown.length === 0 ? (
                <div className="mt-1 text-sm text-gray-500">
                  {t('license.detail.no_usage')}
                </div>
              ) : (
                <div className="mt-1 flex flex-col gap-2">
                  {license.breakdown.map((entry) => (
                    <div key={entry.category}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-aws-font-color">
                          {t(`license.detail.category.${entry.category}`)}
                        </span>
                        {/* eslint-disable-next-line @shopify/jsx-no-hardcoded-content */}
                        <span className="text-aws-font-color tabular-nums">
                          {entry.percent}%
                        </span>
                      </div>
                      <div
                        className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
                        role="progressbar"
                        aria-valuenow={entry.percent}
                        aria-valuemin={0}
                        aria-valuemax={100}>
                        <div
                          className="bg-aws-sky h-full rounded-full"
                          style={{
                            width: `${Math.min(Math.max(entry.percent, 0), 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </ModalDialog>
  );
};

export default LicenseDetailDialog;
