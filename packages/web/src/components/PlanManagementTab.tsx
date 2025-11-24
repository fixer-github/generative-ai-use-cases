import React, { useState, useEffect, useCallback } from 'react';
import { PiCheck, PiSpinnerGap, PiWarningCircle, PiCrown, PiLightning, PiRocket } from 'react-icons/pi';
import useSubscriptionApi, { Plan, CurrentSubscription } from '../hooks/useSubscriptionApi';
import StripeCheckoutModal from './StripeCheckoutModal';

const PlanManagementTab: React.FC = () => {
  const subscriptionApi = useSubscriptionApi();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentSubscription, setCurrentSubscription] = useState<CurrentSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);

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
    if (currentSubscription?.planId === plan.planId && currentSubscription?.status === 'active') {
      // Already subscribed to this plan
      return;
    }

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
      {/* Current Subscription Status */}
      {currentSubscription && currentSubscription.status !== 'none' && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-start">
            <PiCheck className="mr-2 h-5 w-5 text-green-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-900">現在のプラン</p>
              <p className="mt-1 text-sm text-green-700">
                {currentSubscription.planName || 'プラン名不明'}
                {currentSubscription.status === 'active' && ' (アクティブ)'}
                {currentSubscription.cancelAtPeriodEnd && ' - 期間終了時にキャンセル予定'}
              </p>
              {currentSubscription.nextBillingDate && (
                <p className="mt-1 text-xs text-green-600">
                  次回請求日: {new Date(currentSubscription.nextBillingDate).toLocaleDateString('ja-JP')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-start">
            <PiWarningCircle className="mr-2 h-5 w-5 text-red-600" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* Plans Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const isCurrentPlan = currentSubscription?.planId === plan.planId && currentSubscription?.status === 'active';
          const colorScheme = getPlanColorScheme(plan.displayName);

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
    </div>
  );
};

export default PlanManagementTab;