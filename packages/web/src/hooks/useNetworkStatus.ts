import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { logger } from '../utils/logger';

export const useNetworkStatus = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      logger.info('Network connection restored');
      setIsOnline(true);
      toast.success('インターネット接続が復旧しました');
    };

    const handleOffline = () => {
      logger.warn('Network connection lost');
      setIsOnline(false);
      toast.error('インターネット接続が切断されました');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline };
};
