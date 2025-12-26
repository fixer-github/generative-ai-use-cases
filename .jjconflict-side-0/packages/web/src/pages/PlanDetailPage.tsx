import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PiArrowLeft, PiCopy, PiWarning, PiCheckCircle, PiArrowsLeftRight } from 'react-icons/pi';
import Button from '../components/Button';
import Alert from '../components/Alert';
import LoadingOverlay from '../components/LoadingOverlay';
import usePlanApi, {
  Plan,
  PlanHistoryResponse,
  PlanSubscriptionsResponse,
  SetDefaultPlanResponse,
} from '../hooks/usePlanApi';

type TabType = 'basic' | 'permissions' | 'subscriptions' | 'history';

const PlanDetailPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const {
    getPlanDetails,
    getPlanHistory,
    getPlanSubscriptions,
    updatePlanStatus,
    setDefaultPlan,
    listPlans,
  } = usePlanApi();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [history, setHistory] = useState<PlanHistoryResponse | null>(null);
  const [subscriptions, setSubscriptions] = useState<PlanSubscriptionsResponse | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('basic');
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [statusUpdateLoading, setStatusUpdateLoading] = useState(false);
  const [showDefaultPlanDialog, setShowDefaultPlanDialog] = useState(false);
  const [currentDefaultPlan, setCurrentDefaultPlan] = useState<Plan | null>(null);
  const [defaultPlanLoading, setDefaultPlanLoading] = useState(false);

  const loadPlanData = useCallback(async () => {
    if (!planId) return;

    try {
      setLoading(true);
      setError(null);

      const [planData, historyData, subscriptionsData] = await Promise.all([
        getPlanDetails(planId),
        getPlanHistory(planId),
        getPlanSubscriptions(planId),
      ]);

      setPlan(planData);
      setHistory(historyData);
      setSubscriptions(subscriptionsData);
    } catch (err) {
      console.error('Failed to load plan data:', err);
      setError('プランの詳細情報の読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [planId, getPlanDetails, getPlanHistory, getPlanSubscriptions]);

  useEffect(() => {
    loadPlanData();
  }, [loadPlanData]);

  const handleCopyJSON = () => {
    if (!plan) return;
    navigator.clipboard.writeText(JSON.stringify(plan.permissions, null, 2));
    setSuccess('JSONをクリップボードにコピーしました');
    setTimeout(() => setSuccess(null), 3000);
  };

  const getAvailableStatuses = (currentStatus: string): string[] => {
    switch (currentStatus) {
      case 'active':
        return ['closed_to_new'];
      case 'closed_to_new':
        return ['deprecated'];
      default:
        return [];
    }
  };

  const handleStatusUpdate = async () => {
    if (!planId || !selectedStatus || !plan) return;

    // Check if deprecated requires zero subscribers
    if (selectedStatus === 'deprecated' && subscriptions && subscriptions.total_subscribers > 0) {
      setError(
        `このプランには現在${subscriptions.total_subscribers}人の契約者がいるため、廃止できません。すべての契約が終了してから廃止してください。`
      );
      setShowStatusDialog(false);
      return;
    }

    try {
      setStatusUpdateLoading(true);
      setError(null);

      await updatePlanStatus(planId, {
        new_status: selectedStatus as any,
      });

      setSuccess(`ステータスを${getStatusLabel(selectedStatus)}に変更しました`);
      setTimeout(() => setSuccess(null), 5000);

      // Reload plan data
      await loadPlanData();
      setShowStatusDialog(false);
    } catch (err: any) {
      console.error('Failed to update plan status:', err);

      if (err?.response?.data?.error?.code === 'CANNOT_DEPRECATE_WITH_ACTIVE_SUBSCRIPTIONS') {
        setError(err.response.data.error.message);
      } else {
        setError('ステータスの更新に失敗しました');
      }
    } finally {
      setStatusUpdateLoading(false);
    }
  };

  const handleOpenDefaultPlanDialog = async () => {
    try {
      setDefaultPlanLoading(true);
      setError(null);

      // Get current default plan
      const plansData = await listPlans({
        limit: 100,
        platform_type: 'internal',
        status: 'active',
      });

      const defaultPlan = plansData.plans.find(p => p.is_default);
      if (defaultPlan) {
        const defaultPlanDetails = await getPlanDetails(defaultPlan.plan_id);
        setCurrentDefaultPlan(defaultPlanDetails);
      }

      setShowDefaultPlanDialog(true);
    } catch (err) {
      console.error('Failed to load current default plan:', err);
      setError('現在のデフォルトプランの取得に失敗しました');
    } finally {
      setDefaultPlanLoading(false);
    }
  };

  const handleSetDefaultPlan = async () => {
    if (!planId || !plan) return;

    try {
      setDefaultPlanLoading(true);
      setError(null);

      const response: SetDefaultPlanResponse = await setDefaultPlan(planId);

      if (response.previous_default_plan) {
        setSuccess(
          `デフォルトプランを「${response.previous_default_plan.display_name}」から「${response.display_name}」に変更しました`
        );
      } else {
        setSuccess(`「${response.display_name}」をデフォルトプランに設定しました`);
      }
      setTimeout(() => setSuccess(null), 5000);

      // Reload plan data
      await loadPlanData();
      setShowDefaultPlanDialog(false);
      setCurrentDefaultPlan(null);
    } catch (err: any) {
      console.error('Failed to set default plan:', err);
      setError('デフォルトプランの設定に失敗しました');
    } finally {
      setDefaultPlanLoading(false);
    }
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'closed_to_new':
        return 'bg-yellow-100 text-yellow-800';
      case 'deprecated':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return '新規加入可能';
      case 'closed_to_new':
        return '新規受付終了';
      case 'deprecated':
        return '廃止済み';
      default:
        return status;
    }
  };

  const getStatusExplanation = (status: string) => {
    switch (status) {
      case 'active':
        return '新しいユーザがこのプランに加入できる状態です';
      case 'closed_to_new':
        return '既に加入している人は継続できますが、新しい人は加入できない状態です';
      case 'deprecated':
        return '提供を完全に終了した状態です';
      default:
        return '';
    }
  };

  if (loading) {
    return <LoadingOverlay>プランの詳細を読み込み中...</LoadingOverlay>;
  }

  if (!plan) {
    return (
      <div className="px-4 py-6">
        <Alert severity="error">プランが見つかりません</Alert>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 xl:px-12 2xl:px-32">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-4">
            <Button
              outlined
              onClick={() => navigate('/admin/billing/plans')}
              className="mb-4">
              <PiArrowLeft className="mr-2" />
              一覧に戻る
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {plan.internal_name}
                {plan.is_default && (
                  <span className="ml-3 inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm text-green-800">
                    <PiCheckCircle className="mr-1" size={16} />
                    デフォルトプラン
                  </span>
                )}
              </h1>
              <p className="mt-1 text-sm text-gray-600">{plan.display_name}</p>
            </div>
            <div className="flex space-x-3">
              {plan.platform_type === 'internal' &&
               subscriptions &&
               subscriptions.total_subscribers > 0 && (
                <Button
                  className="bg-orange-600 hover:bg-orange-700"
                  onClick={() => navigate(`/admin/billing/plans/${planId}/migrate`)}>
                  <PiArrowsLeftRight className="mr-2" />
                  加入ユーザを別のプランへ移行
                </Button>
              )}
              {plan.platform_type === 'internal' &&
               plan.status === 'active' &&
               !plan.is_default && (
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  onClick={handleOpenDefaultPlanDialog}>
                  デフォルトプランに設定
                </Button>
              )}
              {getAvailableStatuses(plan.status).length > 0 && (
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => setShowStatusDialog(true)}>
                  ステータスを変更
                </Button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6">
            <Alert severity="error" className="w-full">
              {error}
            </Alert>
          </div>
        )}

        {success && (
          <div className="mb-6">
            <Alert severity="info" className="w-full">
              {success}
            </Alert>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('basic')}
                className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium ${
                  activeTab === 'basic'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}>
                基本情報
              </button>
              <button
                onClick={() => setActiveTab('permissions')}
                className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium ${
                  activeTab === 'permissions'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}>
                権限・制限定義
              </button>
              <button
                onClick={() => setActiveTab('subscriptions')}
                className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium ${
                  activeTab === 'subscriptions'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}>
                契約状況
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium ${
                  activeTab === 'history'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}>
                変更履歴
              </button>
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div className="rounded-lg bg-white p-6 shadow">
          {/* Basic Info Tab */}
          {activeTab === 'basic' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">プランID</label>
                  <div className="mt-1 text-sm text-gray-900">{plan.plan_id}</div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">内部名称</label>
                  <div className="mt-1 text-sm text-gray-900">{plan.internal_name}</div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">表示名</label>
                  <div className="mt-1 text-sm text-gray-900">{plan.display_name}</div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    プラットフォーム種別
                  </label>
                  <div className="mt-1">
                    <span className="inline-flex rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">
                      {plan.platform_type}
                    </span>
                  </div>
                </div>
                {plan.platform_product_id && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      プラットフォーム商品ID
                    </label>
                    <div className="mt-1 text-sm text-gray-900">{plan.platform_product_id}</div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700">ステータス</label>
                  <div className="mt-1">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusBadgeColor(plan.status)}`}>
                      {getStatusLabel(plan.status)}
                    </span>
                    <p className="mt-1 text-xs text-gray-500">
                      {getStatusExplanation(plan.status)}
                    </p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">作成日時</label>
                  <div className="mt-1 text-sm text-gray-900">
                    {new Date(plan.created_at).toLocaleString('ja-JP')}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">最終更新日時</label>
                  <div className="mt-1 text-sm text-gray-900">
                    {new Date(plan.updated_at).toLocaleString('ja-JP')}
                  </div>
                </div>
              </div>
              {plan.description && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">説明</label>
                  <div className="mt-1 text-sm text-gray-900">{plan.description}</div>
                </div>
              )}
            </div>
          )}

          {/* Permissions Tab */}
          {activeTab === 'permissions' && (
            <div className="space-y-6">
              <div>
                <h3 className="mb-4 text-lg font-semibold text-gray-900">利用可能な機能</h3>
                <div className="flex flex-wrap gap-2">
                  {plan.permissions.features.map((feature: string) => (
                    <span
                      key={feature}
                      className="inline-flex rounded-full bg-green-100 px-3 py-1 text-sm text-green-800">
                      {feature}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-4 text-lg font-semibold text-gray-900">利用回数の制限</h3>
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          モデル
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          制限タイプ
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          回数
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {Object.entries(plan.permissions.limits).map(([model, limit]: [string, any]) => (
                        <tr key={model}>
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                            {model}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                            {limit.type === 'unlimited'
                              ? '無制限'
                              : limit.type === 'daily'
                                ? '日次制限'
                                : '月次制限'}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                            {limit.type === 'unlimited' ? '-' : `${limit.count}回`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">JSON形式</h3>
                  <Button outlined onClick={handleCopyJSON}>
                    <PiCopy className="mr-2" />
                    コピー
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-lg bg-gray-100 p-4 text-xs">
                  {JSON.stringify(plan.permissions, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Subscriptions Tab */}
          {activeTab === 'subscriptions' && subscriptions && (
            <div className="space-y-6">
              <div>
                <h3 className="mb-4 text-lg font-semibold text-gray-900">契約者数</h3>
                <div className="text-3xl font-bold text-gray-900">
                  {subscriptions.total_subscribers}人
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  最終更新: {new Date(subscriptions.updated_at).toLocaleString('ja-JP')}
                </p>
              </div>

              <div>
                <h3 className="mb-4 text-lg font-semibold text-gray-900">契約種別ごとの内訳</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg border bg-white p-4">
                    <div className="text-sm text-gray-600">サブスクリプション</div>
                    <div className="text-2xl font-semibold text-gray-900">
                      {subscriptions.breakdown_by_source.subscription}人
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white p-4">
                    <div className="text-sm text-gray-600">トライアル</div>
                    <div className="text-2xl font-semibold text-gray-900">
                      {subscriptions.breakdown_by_source.trial}人
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white p-4">
                    <div className="text-sm text-gray-600">手動付与</div>
                    <div className="text-2xl font-semibold text-gray-900">
                      {subscriptions.breakdown_by_source.manual}人
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white p-4">
                    <div className="text-sm text-gray-600">デフォルト</div>
                    <div className="text-2xl font-semibold text-gray-900">
                      {subscriptions.breakdown_by_source.default}人
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white p-4">
                    <div className="text-sm text-gray-600">キャンペーン</div>
                    <div className="text-2xl font-semibold text-gray-900">
                      {subscriptions.breakdown_by_source.campaign}人
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="mb-4 text-lg font-semibold text-gray-900">
                  プラットフォーム別の内訳
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border bg-white p-4">
                    <div className="text-sm text-gray-600">Stripe</div>
                    <div className="text-2xl font-semibold text-gray-900">
                      {subscriptions.breakdown_by_platform.stripe}人
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white p-4">
                    <div className="text-sm text-gray-600">Apple</div>
                    <div className="text-2xl font-semibold text-gray-900">
                      {subscriptions.breakdown_by_platform.apple}人
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white p-4">
                    <div className="text-sm text-gray-600">Google</div>
                    <div className="text-2xl font-semibold text-gray-900">
                      {subscriptions.breakdown_by_platform.google}人
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white p-4">
                    <div className="text-sm text-gray-600">Internal</div>
                    <div className="text-2xl font-semibold text-gray-900">
                      {subscriptions.breakdown_by_platform.internal}人
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && history && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">変更履歴</h3>
              <div className="space-y-4">
                {history.history.map((item) => (
                  <div
                    key={item.change_id}
                    className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">
                          {item.change_summary}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          {new Date(item.changed_at).toLocaleString('ja-JP')} -{' '}
                          {item.changed_by}
                        </div>
                        {item.details && (
                          <div className="mt-2 rounded bg-gray-50 p-2 text-xs">
                            <div>
                              <span className="font-medium">変更前:</span> {item.details.old_value}
                            </div>
                            <div>
                              <span className="font-medium">変更後:</span> {item.details.new_value}
                            </div>
                          </div>
                        )}
                      </div>
                      <span className="ml-4 inline-flex rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-800">
                        {item.change_type}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Status Update Dialog */}
        {showStatusDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
              <h2 className="mb-4 text-xl font-bold text-gray-900">ステータスを変更</h2>

              <div className="mb-6">
                <p className="mb-2 text-sm text-gray-600">現在のステータス:</p>
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${getStatusBadgeColor(plan.status)}`}>
                  {getStatusLabel(plan.status)}
                </span>
              </div>

              <div className="mb-6">
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  変更先のステータス
                </label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2">
                  <option value="">選択してください</option>
                  {getAvailableStatuses(plan.status).map((status) => (
                    <option key={status} value={status}>
                      {getStatusLabel(status)}
                    </option>
                  ))}
                </select>
                {selectedStatus && (
                  <p className="mt-2 text-xs text-gray-500">
                    {getStatusExplanation(selectedStatus)}
                  </p>
                )}
              </div>

              {selectedStatus === 'deprecated' && subscriptions && subscriptions.total_subscribers > 0 && (
                <div className="mb-6 rounded-lg bg-red-50 p-4">
                  <div className="flex">
                    <PiWarning className="mr-2 h-5 w-5 text-red-600" />
                    <div className="text-sm text-red-800">
                      現在{subscriptions.total_subscribers}
                      人の契約者がいるため、このステータスには変更できません。
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-3">
                <Button outlined onClick={() => setShowStatusDialog(false)}>
                  キャンセル
                </Button>
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={handleStatusUpdate}
                  disabled={!selectedStatus || statusUpdateLoading || (selectedStatus === 'deprecated' && (subscriptions?.total_subscribers ?? 0) > 0)}>
                  {statusUpdateLoading ? '更新中...' : '変更を実行'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Default Plan Setting Dialog */}
        {showDefaultPlanDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
              <h2 className="mb-4 text-xl font-bold text-gray-900">デフォルトプランに設定</h2>

              <div className="mb-6">
                <p className="mb-4 text-sm text-gray-600">
                  このプランをデフォルトプランに設定します。
                  新規ユーザー登録時に自動的にこのプランが適用されるようになります。
                </p>

                <div className="rounded-lg bg-blue-50 p-4">
                  <div className="mb-2">
                    <span className="text-sm font-medium text-blue-900">設定するプラン:</span>
                  </div>
                  <div className="text-sm text-blue-800">
                    <div className="font-semibold">{plan.display_name}</div>
                    <div className="text-xs text-blue-600">({plan.internal_name})</div>
                  </div>
                </div>
              </div>

              {currentDefaultPlan && (
                <div className="mb-6">
                  <div className="rounded-lg bg-yellow-50 p-4">
                    <div className="flex">
                      <PiWarning className="mr-2 h-5 w-5 flex-shrink-0 text-yellow-600" />
                      <div>
                        <div className="text-sm font-medium text-yellow-900">
                          現在のデフォルトプランが変更されます
                        </div>
                        <div className="mt-1 text-sm text-yellow-800">
                          現在のデフォルトプラン:
                          <span className="font-semibold"> {currentDefaultPlan.display_name}</span>
                          <span className="text-xs"> ({currentDefaultPlan.internal_name})</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!currentDefaultPlan && (
                <div className="mb-6">
                  <div className="rounded-lg bg-green-50 p-4">
                    <div className="text-sm text-green-800">
                      現在デフォルトプランは設定されていません。
                      このプランが初めてのデフォルトプランとなります。
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-3">
                <Button
                  outlined
                  onClick={() => {
                    setShowDefaultPlanDialog(false);
                    setCurrentDefaultPlan(null);
                  }}
                  disabled={defaultPlanLoading}>
                  キャンセル
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  onClick={handleSetDefaultPlan}
                  disabled={defaultPlanLoading}>
                  {defaultPlanLoading ? '設定中...' : '設定を実行'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlanDetailPage;
