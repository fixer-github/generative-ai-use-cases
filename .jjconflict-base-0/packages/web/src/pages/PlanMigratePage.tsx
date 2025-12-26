import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  PiArrowLeft,
  PiArrowRight,
  PiWarning,
  PiCheckCircle,
} from 'react-icons/pi';
import Button from '../components/Button';
import Alert from '../components/Alert';
import LoadingOverlay from '../components/LoadingOverlay';
import usePlanApi, {
  Plan,
  PlanListItem,
  SubscriberInfo,
  MigratePlanSubscribersResponse,
} from '../hooks/usePlanApi';

const PlanMigratePage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const {
    getPlanDetails,
    listPlans,
    getPlanSubscribers,
    migratePlanSubscribers,
  } = usePlanApi();

  // State
  const [sourcePlan, setSourcePlan] = useState<Plan | null>(null);
  const [targetPlans, setTargetPlans] = useState<PlanListItem[]>([]);
  const [selectedTargetPlanId, setSelectedTargetPlanId] = useState<string>('');
  const [subscribers, setSubscribers] = useState<SubscriberInfo[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalCount: 0,
    limit: 20,
  });

  const [loading, setLoading] = useState(true);
  const [subscribersLoading, setSubscribersLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migrationResult, setMigrationResult] =
    useState<MigratePlanSubscribersResponse | null>(null);

  // Load source plan and target plans
  useEffect(() => {
    const loadInitialData = async () => {
      if (!planId) return;

      try {
        setLoading(true);
        setError(null);

        const [planData, plansData] = await Promise.all([
          getPlanDetails(planId),
          listPlans({
            platform_type: 'internal',
            status: 'active',
            limit: 100,
          }),
        ]);

        // Verify source plan is internal
        if (planData.platform_type !== 'internal') {
          setError('このプランはinternalプランではないため、移行機能を使用できません');
          return;
        }

        setSourcePlan(planData);

        // Filter out the source plan from target options
        const availableTargets = plansData.plans.filter(
          (p) => p.plan_id !== planId
        );
        setTargetPlans(availableTargets);
      } catch (err) {
        console.error('Failed to load initial data:', err);
        setError('データの読み込みに失敗しました');
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, [planId, getPlanDetails, listPlans]);

  // Load subscribers when page changes
  const loadSubscribers = useCallback(
    async (page: number) => {
      if (!planId) return;

      try {
        setSubscribersLoading(true);
        setError(null);

        const data = await getPlanSubscribers(planId, {
          page,
          limit: pagination.limit,
        });

        setSubscribers(data.subscribers);
        setPagination({
          currentPage: data.pagination.current_page,
          totalPages: data.pagination.total_pages,
          totalCount: data.pagination.total_count,
          limit: data.pagination.limit,
        });

        // Select all by default
        setSelectedUserIds(new Set(data.subscribers.map((s) => s.user_id)));
      } catch (err) {
        console.error('Failed to load subscribers:', err);
        setError('加入者一覧の読み込みに失敗しました');
      } finally {
        setSubscribersLoading(false);
      }
    },
    [planId, getPlanSubscribers, pagination.limit]
  );

  // Load subscribers when target plan is selected
  useEffect(() => {
    if (selectedTargetPlanId) {
      loadSubscribers(1);
    }
  }, [selectedTargetPlanId, loadSubscribers]);

  const handlePageChange = (newPage: number) => {
    loadSubscribers(newPage);
  };

  const handleSelectAll = () => {
    setSelectedUserIds(new Set(subscribers.map((s) => s.user_id)));
  };

  const handleDeselectAll = () => {
    setSelectedUserIds(new Set());
  };

  const handleToggleUser = (userId: string) => {
    const newSelected = new Set(selectedUserIds);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUserIds(newSelected);
  };

  const handleMigrate = async () => {
    if (!planId || !selectedTargetPlanId || selectedUserIds.size === 0) return;

    try {
      setMigrating(true);
      setError(null);
      setMigrationResult(null);

      const result = await migratePlanSubscribers(planId, {
        targetPlanId: selectedTargetPlanId,
        userIds: Array.from(selectedUserIds),
      });

      setMigrationResult(result);

      // Remove successfully migrated users from the list
      const successUserIds = new Set(
        result.results.filter((r) => r.success).map((r) => r.userId)
      );
      setSubscribers((prev) =>
        prev.filter((s) => !successUserIds.has(s.user_id))
      );
      setSelectedUserIds((prev) => {
        const newSet = new Set(prev);
        successUserIds.forEach((id) => newSet.delete(id));
        return newSet;
      });

      // Update pagination total count
      setPagination((prev) => ({
        ...prev,
        totalCount: prev.totalCount - result.successCount,
      }));
    } catch (err: any) {
      console.error('Failed to migrate subscribers:', err);
      setError(err?.response?.data?.error?.message || '移行処理に失敗しました');
    } finally {
      setMigrating(false);
    }
  };

  const getApplicationSourceLabel = (source: string) => {
    switch (source) {
      case 'subscription':
        return 'サブスクリプション';
      case 'default':
        return 'デフォルト';
      case 'trial':
        return 'トライアル';
      case 'campaign':
        return 'キャンペーン';
      case 'manual':
        return '手動付与';
      default:
        return source;
    }
  };

  if (loading) {
    return <LoadingOverlay>データを読み込み中...</LoadingOverlay>;
  }

  if (!sourcePlan) {
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
          <Button
            outlined
            onClick={() => navigate(`/admin/billing/plans/${planId}`)}
            className="mb-4">
            <PiArrowLeft className="mr-2" />
            プラン詳細に戻る
          </Button>

          <h1 className="text-2xl font-bold text-gray-900">
            加入ユーザを別のプランへ移行
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            「{sourcePlan.display_name}」の加入者を別のプランに移行します
          </p>
        </div>

        {error && (
          <div className="mb-6">
            <Alert severity="error" className="w-full">
              {error}
            </Alert>
          </div>
        )}

        {/* Migration Result */}
        {migrationResult && (
          <div className="mb-6">
            <div
              className={`rounded-lg p-4 ${
                migrationResult.failureCount === 0
                  ? 'bg-green-50'
                  : migrationResult.successCount === 0
                    ? 'bg-red-50'
                    : 'bg-yellow-50'
              }`}>
              <h3 className="mb-2 font-semibold text-gray-900">移行結果</h3>
              <div className="mb-2 text-sm">
                <span className="text-green-700">
                  成功: {migrationResult.successCount}件
                </span>
                {migrationResult.failureCount > 0 && (
                  <span className="ml-4 text-red-700">
                    失敗: {migrationResult.failureCount}件
                  </span>
                )}
              </div>

              {migrationResult.failureCount > 0 && (
                <div className="mt-3 space-y-1">
                  <p className="text-sm font-medium text-gray-700">
                    失敗したユーザ:
                  </p>
                  {migrationResult.results
                    .filter((r) => !r.success)
                    .map((r) => (
                      <div key={r.userId} className="text-sm text-red-700">
                        {r.userId}: {r.error?.message}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 1: Select Target Plan */}
        <div className="mb-6 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Step 1: 移行先プランを選択
          </h2>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                移行元プラン
              </label>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="font-medium text-gray-900">
                  {sourcePlan.display_name}
                </div>
                <div className="text-sm text-gray-500">
                  {sourcePlan.internal_name}
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                移行先プラン
              </label>
              {targetPlans.length === 0 ? (
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                  <div className="flex items-center text-yellow-800">
                    <PiWarning className="mr-2" />
                    <span>
                      移行可能なプランがありません。新規加入を受け付けているinternalプランが必要です。
                    </span>
                  </div>
                </div>
              ) : (
                <select
                  value={selectedTargetPlanId}
                  onChange={(e) => setSelectedTargetPlanId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="">選択してください</option>
                  {targetPlans.map((plan) => (
                    <option key={plan.plan_id} value={plan.plan_id}>
                      {plan.display_name} ({plan.internal_name})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {selectedTargetPlanId && (
            <div className="mt-4 flex items-center text-green-700">
              <PiArrowRight className="mr-2" />
              <span>
                「{sourcePlan.display_name}」から「
                {targetPlans.find((p) => p.plan_id === selectedTargetPlanId)
                  ?.display_name}
                」へ移行
              </span>
            </div>
          )}
        </div>

        {/* Step 2: Select Users */}
        {selectedTargetPlanId && (
          <div className="mb-6 rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Step 2: 移行するユーザを選択
            </h2>

            {subscribersLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900"></div>
                <span className="ml-2 text-gray-600">読み込み中...</span>
              </div>
            ) : subscribers.length === 0 ? (
              <div className="py-8 text-center text-gray-500">
                移行対象のユーザがいません
              </div>
            ) : (
              <>
                {/* Selection Controls */}
                <div className="mb-4 flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    {selectedUserIds.size} / {subscribers.length} 件選択中
                    （全{pagination.totalCount}件）
                  </div>
                  <div className="space-x-2">
                    <Button outlined onClick={handleSelectAll}>
                      すべて選択
                    </Button>
                    <Button outlined onClick={handleDeselectAll}>
                      選択解除
                    </Button>
                  </div>
                </div>

                {/* Subscribers Table */}
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="w-12 px-4 py-3">
                          <input
                            type="checkbox"
                            checked={
                              selectedUserIds.size === subscribers.length &&
                              subscribers.length > 0
                            }
                            onChange={(e) =>
                              e.target.checked
                                ? handleSelectAll()
                                : handleDeselectAll()
                            }
                            className="h-4 w-4 rounded border-gray-300"
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          メールアドレス
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          ユーザID
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          適用種別
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          適用日
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {subscribers.map((subscriber) => (
                        <tr
                          key={subscriber.user_id}
                          className={
                            selectedUserIds.has(subscriber.user_id)
                              ? 'bg-blue-50'
                              : ''
                          }>
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedUserIds.has(subscriber.user_id)}
                              onChange={() =>
                                handleToggleUser(subscriber.user_id)
                              }
                              className="h-4 w-4 rounded border-gray-300"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {subscriber.email || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            <span className="font-mono text-xs">
                              {subscriber.user_id.substring(0, 8)}...
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {getApplicationSourceLabel(
                              subscriber.application_source
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {new Date(subscriber.valid_from).toLocaleDateString(
                              'ja-JP'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {pagination.totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-sm text-gray-600">
                      ページ {pagination.currentPage} / {pagination.totalPages}
                    </div>
                    <div className="space-x-2">
                      <Button
                        outlined
                        onClick={() =>
                          handlePageChange(pagination.currentPage - 1)
                        }
                        disabled={pagination.currentPage === 1}>
                        前へ
                      </Button>
                      <Button
                        outlined
                        onClick={() =>
                          handlePageChange(pagination.currentPage + 1)
                        }
                        disabled={
                          pagination.currentPage === pagination.totalPages
                        }>
                        次へ
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Step 3: Execute Migration */}
        {selectedTargetPlanId && subscribers.length > 0 && (
          <div className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Step 3: 移行を実行
            </h2>

            <div className="mb-4 rounded-lg bg-yellow-50 p-4">
              <div className="flex">
                <PiWarning className="mr-2 h-5 w-5 flex-shrink-0 text-yellow-600" />
                <div className="text-sm text-yellow-800">
                  <p className="font-medium">移行前の確認事項</p>
                  <ul className="ml-4 mt-1 list-disc">
                    <li>
                      選択した{selectedUserIds.size}
                      名のユーザのプランが変更されます
                    </li>
                    <li>
                      移行は即時反映され、ユーザは新しいプランの権限で利用できるようになります
                    </li>
                    <li>この操作は元に戻すことができません</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3">
              <Button
                outlined
                onClick={() => navigate(`/admin/billing/plans/${planId}`)}>
                キャンセル
              </Button>
              <Button
                className="bg-orange-600 hover:bg-orange-700"
                onClick={handleMigrate}
                disabled={migrating || selectedUserIds.size === 0}>
                {migrating ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    移行処理中...
                  </>
                ) : (
                  <>
                    <PiCheckCircle className="mr-2" />
                    {selectedUserIds.size}名を移行する
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlanMigratePage;
