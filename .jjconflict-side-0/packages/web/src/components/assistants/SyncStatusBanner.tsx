import React from 'react';
import { SyncStatus, getStatusInfo } from './statusMetadata';
import {
  PiSpinnerGap,
  PiWarning,
  PiXCircle,
} from 'react-icons/pi';
import { useTranslation } from 'react-i18next';
import Alert from '../Alert';

type Props = {
  syncStatus: SyncStatus;
  syncStatusReason?: string;
  onRetry?: () => void;
  failedSourceCount?: number;
};

const SyncStatusBanner: React.FC<Props> = ({
  syncStatus,
  syncStatusReason,
  onRetry,
  failedSourceCount,
}) => {
  const { t } = useTranslation();
  const statusInfo = getStatusInfo(syncStatus);

  // Don't show banner for successful syncs
  if (syncStatus === 'SUCCEEDED') {
    return null;
  }

  const getSeverity = (): 'info' | 'error' | 'warning' => {
    if (syncStatus === 'FAILED') return 'error';
    if (syncStatus === 'PARTIAL') return 'warning';
    if (syncStatus === 'QUEUED' || syncStatus === 'SYNCING') return 'info';
    return 'info';
  };

  const getIcon = () => {
    switch (syncStatus) {
      case 'QUEUED':
      case 'SYNCING':
        return <PiSpinnerGap className="mt-0.5 animate-spin text-lg" />;
      case 'FAILED':
        return <PiXCircle className="mt-0.5 text-lg" />;
      case 'PARTIAL':
        return <PiWarning className="mt-0.5 text-lg" />;
      default:
        return null;
    }
  };

  const getTitle = () => {
    switch (syncStatus) {
      case 'QUEUED':
      case 'SYNCING':
        return t('assistant.chatPage.syncingAlertTitle');
      case 'FAILED':
        return t('assistant.chatPage.failedAlertTitle');
      case 'PARTIAL':
        return t('assistant.chatPage.partialAlertTitle');
      default:
        return t(statusInfo.labelKey);
    }
  };

  const getMessage = () => {
    switch (syncStatus) {
      case 'QUEUED':
      case 'SYNCING':
        return t('assistant.chatPage.syncingAlertMessage');
      case 'FAILED':
        return syncStatusReason || t('assistant.statusMessage.failed');
      case 'PARTIAL':
        return t('assistant.chatPage.partialAlertMessage', {
          count: failedSourceCount ?? 0,
        });
      default:
        return '';
    }
  };

  return (
    <Alert severity={getSeverity()} className="m-4">
      <div className="flex items-start gap-2">
        {getIcon()}
        <div className="flex-1">
          <div className="font-semibold">{getTitle()}</div>
          {getMessage() && <div className="mt-1 text-xs">{getMessage()}</div>}
        </div>
        {syncStatus === 'FAILED' && onRetry && (
          <button
            onClick={onRetry}
            className="rounded bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50">
            {t('common.retry')}
          </button>
        )}
      </div>
    </Alert>
  );
};

export default SyncStatusBanner;
