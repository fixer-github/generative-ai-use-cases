import React, { useState, useEffect, useCallback } from 'react';
import { PiCheck, PiSpinnerGap, PiWarningCircle, PiCrown, PiLightning, PiRocket } from 'react-icons/pi';
import useSubscriptionApi, { Plan, CurrentSubscription } from '../hooks/useSubscriptionApi';
import StripeCheckoutModal from './StripeCheckoutModal';
import CancelSubscriptionModal from './CancelSubscriptionModal';
import ChangePlanModal from './ChangePlanModal';

const PlanManagementTab: React.FC = () => {
  const subscriptionApi = useSubscriptionApi();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentSubscription, setCurrentSubscription] = useState<CurrentSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showChangePlanModal, setShowChangePlanModal] = useState(false);
  const [planToChangeTo, setPlanToChangeTo] = useState<Plan | null>(null);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);

  // Fetch plans and current subscription
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [plansResponse, subscriptionResponse] = await Promise.all([
        subscriptionApi.listPlans(),
        subscriptionApi.getCurrentSubscription(),
      ]);
      setPlans(plansResponse.plans);
      setCurrentSubscription(subscriptionResponse);
    } catch (err) {
      console.error('Failed to fetch plan data:', err);
      setError('プラン情報の取得に失敗しました。後でもう一度お試しください。');
    } finally {
      setLoading(false);
    }
  }, [subscriptionApi]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle plan selection
  const handleSelectPlan = async (plan: Plan) => {
    console.log('handleSelectPlan called', {
      plan,
      currentSubscription,
      isDefaultPlan: plan.pricing?.amount === 0 || !plan.platformProductId
    });

    if (currentSubscription?.planId === plan.planId && currentSubscription?.status === 'active') {
      // Already subscribed to this plan
      console.log('Already subscribed to this plan');
      return;
    }

    // デフォルトプランへの変更は実質的に解約
    if (plan.pricing?.amount === 0 || !plan.platformProductId) {
      console.log('Default plan selected, checking subscription', {
        hasSubscriptionId: !!currentSubscription?.subscriptionId
      });
      // デフォルトプランの場合は解約モーダルを表示
      // ただし、有効なサブスクリプションが存在する場合のみ
      if (currentSubscription?.subscriptionId) {
        setShowCancelModal(true);
      } else {
        // サブスクリプションが存在しない場合はエラーメッセージを表示
        setError('有効なサブスクリプションが存在しません。');
      }
      return;
    }

    // Check if user has active subscription - if yes, show change plan modal
    if (
      currentSubscription?.status === 'active' &&
      currentSubscription?.subscriptionId &&
      !currentSubscription?.cancelAtPeriodEnd
    ) {
      // User has active subscription - show change plan modal
      setPlanToChangeTo(plan);
      setShowChangePlanModal(true);
    } else {
      // No active subscription - proceed with new subscription checkout
      setSelectedPlan(plan);
      setIsCreatingSession(true);
      setError(null);

      try {
        const sessionResponse = await subscriptionApi.createCheckoutSession({
          planId: plan.planId,
        });
        setCheckoutClientSecret(sessionResponse.client_secret);
      } catch (err) {
        console.error('Failed to create checkout session:', err);
        setError('チェックアウトセッションの作成に失敗しました。');
        setSelectedPlan(null);
      } finally {
        setIsCreatingSession(false);
      }
    }
  };

  // Handle checkout modal close
  const handleCheckoutClose = () => {
    setCheckoutClientSecret(null);
    setSelectedPlan(null);
  };

  // Handle checkout success
  const handleCheckoutSuccess = () => {
    setCheckoutClientSecret(null);
    setSelectedPlan(null);
    // Refresh subscription data
    fetchData();
  };

  // Handle subscription cancellation
  const handleCancelSubscription = () => {
    setShowCancelModal(true);
  };

  // Handle opening Customer Portal
  const handleOpenCustomerPortal = async () => {
    setIsOpeningPortal(true);
    setError(null);

    try {
      const response = await subscriptionApi.createCustomerPortalSession({
        returnUrl: window.location.href,
      });

      // Customer PortalのURLを新しいタブで開く
      window.open(response.url, '_blank');
    } catch (err) {
      console.error('Failed to create Customer Portal session:', err);
      setError('お支払い管理画面の表示に失敗しました。後でもう一度お試しください。');
    } finally {
      setIsOpeningPortal(false);
    }
  };

  // Handle cancel modal close
  const handleCancelModalClose = () => {
    setShowCancelModal(false);
  };

  // Handle cancel success
  const handleCancelSuccess = () => {
    setShowCancelModal(false);
    // Refresh subscription data
    fetchData();
  };

  // Handle change plan modal close
  const handleChangePlanModalClose = () => {
    setShowChangePlanModal(false);
    setPlanToChangeTo(null);
  };

  // Handle change plan success
  const handleChangePlanSuccess = () => {
    setShowChangePlanModal(false);
    setPlanToChangeTo(null);
    // Refresh subscription data
    fetchData();
  };

  // Get plan icon
  const getPlanIcon = (planName: string) => {
    const name = planName.toLowerCase();
    if (name.includes('premium') || name.includes('プレミアム')) {
      return <PiCrown className="h-8 w-8" />;
    } else if (name.includes('standard') || name.includes('スタンダード')) {
      return <PiRocket className="h-8 w-8" />;
    } else if (name.includes('free') || name.includes('フリー') || name.includes('無料')) {
      return <PiLightning className="h-8 w-8" />;
    }
    return <PiRocket className="h-8 w-8" />;
  };

  // Get plan color scheme
  const getPlanColorScheme = (planName: string) => {
    const name = planName.toLowerCase();
    if (name.includes('premium') || name.includes('プレミアム')) {
      return {
        border: 'border-purple-200',
        bg: 'bg-gradient-to-br from-purple-50 to-purple-100',
        iconColor: 'text-purple-600',
        buttonBg: 'bg-purple-600 hover:bg-purple-700',
        buttonText: 'text-white',
        badge: 'bg-purple-100 text-purple-800',
      };
    } else if (name.includes('standard') || name.includes('スタンダード')) {
      return {
        border: 'border-blue-200',
        bg: 'bg-gradient-to-br from-blue-50 to-blue-100',
        iconColor: 'text-blue-600',
        buttonBg: 'bg-blue-600 hover:bg-blue-700',
        buttonText: 'text-white',
        badge: 'bg-blue-100 text-blue-800',
      };
    }
    return {
      border: 'border-gray-200',
      bg: 'bg-white',
      iconColor: 'text-gray-600',
      buttonBg: 'bg-gray-600 hover:bg-gray-700',
      buttonText: 'text-white',
      badge: 'bg-gray-100 text-gray-800',
    };
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

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <PiSpinnerGap className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error && !plans.length) {
    return (
      <div className="flex h-96 flex-col items-center justify-center">
        <PiWarningCircle className="mb-4 h-12 w-12 text-gray-400" />
        <p className="text-sm text-gray-600">{error}</p>
        <button
          onClick={fetchData}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
          再試行
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-start">
            <PiWarningCircle className="mr-2 h-5 w-5 text-red-600" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* Current Subscription Info */}
      {currentSubscription &&
       currentSubscription.status === 'active' &&
       currentSubscription.subscriptionId && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">現在のサブスクリプション</h3>
              <div className="mt-2 space-y-1">
                <p className="text-sm text-gray-700">
                  プラン: <span className="font-medium">{currentSubscription.planName || '未設定'}</span>
                </p>
                {currentSubscription.nextBillingDate && (
                  <p className="text-sm text-gray-700">
                    次回請求日: <span className="font-medium">
                      {new Date(currentSubscription.nextBillingDate).toLocaleDateString('ja-JP')}
                    </span>
                  </p>
                )}
                {currentSubscription.cancelAtPeriodEnd && (
                  <p className="text-sm text-orange-700">
                    ※ このサブスクリプションは
                    {currentSubscription.nextBillingDate &&
                      new Date(currentSubscription.nextBillingDate).toLocaleDateString('ja-JP')
                    }
                    に解約されます。それまでは現在のプランをご利用いただけます。
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleOpenCustomerPortal}
                disabled={isOpeningPortal}
                className="rounded-md border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed">
                {isOpeningPortal ? (
                  <span className="flex items-center gap-2">
                    <PiSpinnerGap className="animate-spin" />
                    読み込み中...
                  </span>
                ) : (
                  'お支払い管理'
                )}
              </button>
              {!currentSubscription.cancelAtPeriodEnd && (
                <button
                  onClick={handleCancelSubscription}
                  className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
                  解約する
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Plans Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const isCurrentPlan = currentSubscription?.planId === plan.planId && currentSubscription?.status === 'active';
          const colorScheme = getPlanColorScheme(plan.displayName);
          const currentPlan = plans.find(p => p.planId === currentSubscription?.planId);

          return (
            <div
              key={plan.planId}
              className={`relative overflow-hidden rounded-lg border ${colorScheme.border} ${colorScheme.bg} p-6 transition-transform hover:scale-105`}>
              {/* Current Plan Badge */}
              {isCurrentPlan && (
                <div className="absolute right-2 top-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colorScheme.badge}`}>
                    現在のプラン
                  </span>
                </div>
              )}

              {/* Plan Icon */}
              <div className={`mb-4 ${colorScheme.iconColor}`}>
                {getPlanIcon(plan.displayName)}
              </div>

              {/* Plan Name */}
              <h3 className="text-lg font-semibold text-gray-900">{plan.displayName}</h3>

              {/* Plan Price */}
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {formatPrice(plan)}
              </p>

              {/* Plan Description */}
              {plan.description && (
                <p className="mt-3 text-sm text-gray-600">{plan.description}</p>
              )}

              {/* Features List */}
              {plan.features && plan.features.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {plan.features.slice(0, 4).map((feature, index) => (
                    <li key={index} className="flex items-start text-sm text-gray-600">
                      <PiCheck className="mr-2 h-4 w-4 shrink-0 text-green-500" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Limits */}
              {plan.limits && Object.keys(plan.limits).length > 0 && (
                <div className="mt-4 space-y-1">
                  {Object.entries(plan.limits).slice(0, 2).map(([key, limit]) => (
                    <p key={key} className="text-xs text-gray-500">
                      {key}: {limit.type === 'unlimited' ? '無制限' : `${limit.count}回/${limit.type === 'daily' ? '日' : '月'}`}
                    </p>
                  ))}
                </div>
              )}

              {/* Action Button */}
              <button
                onClick={() => handleSelectPlan(plan)}
                disabled={isCurrentPlan || isCreatingSession || plan.status !== 'active'}
                className={`mt-6 w-full rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  isCurrentPlan
                    ? 'cursor-default bg-gray-100 text-gray-400'
                    : plan.status !== 'active'
                    ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                    : `${colorScheme.buttonBg} ${colorScheme.buttonText}`
                }`}>
                {isCurrentPlan
                  ? '現在利用中'
                  : plan.status !== 'active'
                  ? '利用不可'
                  : isCreatingSession && selectedPlan?.planId === plan.planId
                  ? '処理中...'
                  : currentSubscription?.status === 'active' && currentSubscription?.subscriptionId && !currentSubscription?.cancelAtPeriodEnd
                  ? (plan.pricing?.amount || 0) > (currentPlan?.pricing?.amount || 0)
                    ? 'アップグレード'
                    : 'ダウングレード'
                  : '選択する'}
              </button>
            </div>
          );
        })}
      </div>

      {/* No Plans Available */}
      {plans.length === 0 && (
        <div className="flex h-64 flex-col items-center justify-center text-gray-500">
          <p className="text-sm">利用可能なプランがありません</p>
        </div>
      )}

      {/* Stripe Checkout Modal */}
      {checkoutClientSecret && (
        <StripeCheckoutModal
          clientSecret={checkoutClientSecret}
          onClose={handleCheckoutClose}
          onSuccess={handleCheckoutSuccess}
        />
      )}

      {/* Cancel Subscription Modal */}
      {showCancelModal && currentSubscription?.subscriptionId && (
        <CancelSubscriptionModal
          subscriptionId={currentSubscription.subscriptionId}
          planName={currentSubscription.planName || 'プラン'}
          nextBillingDate={currentSubscription.nextBillingDate || undefined}
          onClose={handleCancelModalClose}
          onSuccess={handleCancelSuccess}
        />
      )}

      {/* Change Plan Modal */}
      {showChangePlanModal &&
       planToChangeTo &&
       currentSubscription?.subscriptionId &&
       currentSubscription?.planId && (
        <ChangePlanModal
          currentPlan={plans.find(p => p.planId === currentSubscription.planId) || planToChangeTo}
          newPlan={planToChangeTo}
          subscriptionId={currentSubscription.subscriptionId}
          nextBillingDate={currentSubscription.nextBillingDate || undefined}
          onClose={handleChangePlanModalClose}
          onSuccess={handleChangePlanSuccess}
        />
      )}
    </div>
  );
};

export default PlanManagementTab;