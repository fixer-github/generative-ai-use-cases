import React, { useState } from 'react';
import { PiInfo, PiX, PiSpinnerGap, PiArrowUp, PiArrowDown } from 'react-icons/pi';
import useSubscriptionApi, { Plan } from '../hooks/useSubscriptionApi';

interface ChangePlanModalProps {
  currentPlan: Plan;
  newPlan: Plan;
  subscriptionId: string;
  nextBillingDate?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const ChangePlanModal: React.FC<ChangePlanModalProps> = ({
  currentPlan,
  newPlan,
  subscriptionId,
  nextBillingDate,
  onClose,
  onSuccess,
}) => {
  const subscriptionApi = useSubscriptionApi();
  const [isChanging, setIsChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine if this is an upgrade or downgrade based on price
  const isUpgrade =
    (newPlan.pricing?.amount || 0) > (currentPlan.pricing?.amount || 0);

  const handleConfirm = async () => {
    setIsChanging(true);
    setError(null);

    try {
      const response = await subscriptionApi.changeSubscriptionPlan(
        subscriptionId,
        newPlan.planId
      );

      if (response.success) {
        onSuccess();
      } else {
        setError('プラン変更に失敗しました。もう一度お試しください。');
      }
    } catch (err) {
      console.error('Failed to change plan:', err);
      setError('プラン変更中にエラーが発生しました。');
    } finally {
      setIsChanging(false);
    }
  };

  // Format price
  const formatPrice = (plan: Plan) => {
    if (!plan.pricing) return '無料';
    const { amount, currency, interval } = plan.pricing;
    const formattedAmount = new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: currency || 'JPY',
    }).format(amount);

    if (interval === 'month') {
      return `${formattedAmount}/月`;
    } else if (interval === 'year') {
      return `${formattedAmount}/年`;
    }
    return formattedAmount;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-6 shadow-xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
          disabled={isChanging}>
          <PiX className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="mb-6">
          <div className="mb-4 flex justify-center">
            <div className={`rounded-full p-3 ${isUpgrade ? 'bg-green-100' : 'bg-blue-100'}`}>
              {isUpgrade ? (
                <PiArrowUp className="h-8 w-8 text-green-600" />
              ) : (
                <PiArrowDown className="h-8 w-8 text-blue-600" />
              )}
            </div>
          </div>
          <h2 className="text-center text-xl font-semibold text-gray-900">
            {isUpgrade ? 'プランをアップグレード' : 'プランをダウングレード'}
          </h2>
        </div>

        {/* Plan Comparison */}
        <div className="mb-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Current Plan */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-600">現在のプラン</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">
                {currentPlan.displayName}
              </p>
              <p className="mt-2 text-xl font-bold text-gray-900">
                {formatPrice(currentPlan)}
              </p>
              {currentPlan.features && currentPlan.features.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {currentPlan.features.slice(0, 3).map((feature, index) => (
                    <li key={index} className="text-xs text-gray-600">
                      • {feature}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* New Plan */}
            <div className={`rounded-lg border p-4 ${
              isUpgrade
                ? 'border-green-300 bg-green-50'
                : 'border-blue-300 bg-blue-50'
            }`}>
              <p className={`text-sm font-medium ${
                isUpgrade ? 'text-green-700' : 'text-blue-700'
              }`}>
                新しいプラン
              </p>
              <p className="mt-1 text-lg font-semibold text-gray-900">
                {newPlan.displayName}
              </p>
              <p className="mt-2 text-xl font-bold text-gray-900">
                {formatPrice(newPlan)}
              </p>
              {newPlan.features && newPlan.features.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {newPlan.features.slice(0, 3).map((feature, index) => (
                    <li key={index} className="text-xs text-gray-600">
                      • {feature}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Important Notes */}
          <div className={`rounded-lg border p-4 ${
            isUpgrade
              ? 'border-green-200 bg-green-50'
              : 'border-blue-200 bg-blue-50'
          }`}>
            <div className="flex items-start">
              <PiInfo className={`mr-2 h-5 w-5 shrink-0 ${
                isUpgrade ? 'text-green-600' : 'text-blue-600'
              }`} />
              <div>
                <p className={`text-sm font-medium ${
                  isUpgrade ? 'text-green-800' : 'text-blue-800'
                }`}>
                  {isUpgrade ? 'アップグレードについて' : 'ダウングレードについて'}
                </p>
                <ul className={`mt-2 space-y-1 text-sm ${
                  isUpgrade ? 'text-green-700' : 'text-blue-700'
                }`}>
                  {isUpgrade ? (
                    <>
                      <li>• 新しいプランは即座に有効になります</li>
                      <li>• 差額は日割り計算されて請求されます</li>
                      <li>• すべての新機能がすぐに利用可能になります</li>
                    </>
                  ) : (
                    <>
                      <li>
                        • 変更は
                        {nextBillingDate && (
                          <>
                            {new Date(nextBillingDate).toLocaleDateString('ja-JP')}
                          </>
                        )}
                        に適用されます
                      </li>
                      <li>• それまでは現在のプランを継続利用できます</li>
                      <li>• すでに支払った料金の返金はありません</li>
                    </>
                  )}
                </ul>
              </div>
            </div>
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
            disabled={isChanging}
            className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            disabled={isChanging}
            className={`flex flex-1 items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${
              isUpgrade
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}>
            {isChanging ? (
              <>
                <PiSpinnerGap className="mr-2 h-4 w-4 animate-spin" />
                処理中...
              </>
            ) : (
              `${isUpgrade ? 'アップグレード' : 'ダウングレード'}する`
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChangePlanModal;