import React, { useState } from 'react';
import { PiWarningCircle, PiX, PiSpinnerGap } from 'react-icons/pi';
import useSubscriptionApi from '../hooks/useSubscriptionApi';

interface CancelSubscriptionModalProps {
  subscriptionId: string;
  planName: string;
  nextBillingDate?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const CancelSubscriptionModal: React.FC<CancelSubscriptionModalProps> = ({
  subscriptionId,
  planName,
  nextBillingDate,
  onClose,
  onSuccess,
}) => {
  const subscriptionApi = useSubscriptionApi();
  const [isCanceling, setIsCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCancel = async () => {
    setIsCanceling(true);
    setError(null);

    try {
      const response = await subscriptionApi.cancelSubscription(subscriptionId);
      if (response.success) {
        onSuccess();
      } else {
        setError('解約処理に失敗しました。もう一度お試しください。');
      }
    } catch (err) {
      console.error('Failed to cancel subscription:', err);
      setError('解約処理中にエラーが発生しました。');
    } finally {
      setIsCanceling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="relative max-h-[90vh] w-full max-w-md overflow-auto rounded-lg bg-white p-6 shadow-xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
          disabled={isCanceling}>
          <PiX className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="mb-6">
          <div className="mb-4 flex justify-center">
            <div className="rounded-full bg-red-100 p-3">
              <PiWarningCircle className="h-8 w-8 text-red-600" />
            </div>
          </div>
          <h2 className="text-center text-xl font-semibold text-gray-900">
            サブスクリプションを解約しますか？
          </h2>
        </div>

        {/* Content */}
        <div className="mb-6 space-y-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-700">現在のプラン</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{planName}</p>
          </div>

          {nextBillingDate && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm text-blue-800">
                <strong>重要：</strong>解約は次回請求日（
                {new Date(nextBillingDate).toLocaleDateString('ja-JP')}
                ）に有効となります。それまでは現在のプランをご利用いただけます。
              </p>
            </div>
          )}

          <div className="space-y-2 text-sm text-gray-600">
            <p>解約すると以下の影響があります：</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>次回請求日以降、有料プランの機能が利用できなくなります</li>
              <li>フリープランに自動的に移行されます</li>
              <li>作成済みのデータは保持されます</li>
            </ul>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex space-x-3">
          <button
            onClick={onClose}
            disabled={isCanceling}
            className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
            キャンセル
          </button>
          <button
            onClick={handleCancel}
            disabled={isCanceling}
            className="flex flex-1 items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
            {isCanceling ? (
              <>
                <PiSpinnerGap className="mr-2 h-4 w-4 animate-spin" />
                処理中...
              </>
            ) : (
              '解約する'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CancelSubscriptionModal;