import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PiCreditCard, PiPlus, PiMagnifyingGlass, PiCheckCircle } from 'react-icons/pi';
import Button from '../components/Button';
import Alert from '../components/Alert';
import LoadingOverlay from '../components/LoadingOverlay';
import usePlanApi, { PlanListItem, PlanListResponse } from '../hooks/usePlanApi';

const PlanManagementPage: React.FC = () => {
  const navigate = useNavigate();
  const { listPlans } = usePlanApi();

  const [planData, setPlanData] = useState<PlanListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'created_at' | 'internal_name' | 'status'>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);

  const loadPlans = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params: Parameters<typeof listPlans>[0] = {
        page: currentPage,
        limit: 20,
        sort_by: sortBy,
        sort_order: sortOrder,
      };

      if (search) params.search = search;
      if (platformFilter) params.platform_type = platformFilter as any;
      if (statusFilter) params.status = statusFilter as any;

      const data = await listPlans(params);
      setPlanData(data);
    } catch (err) {
      console.error('Failed to load plans:', err);
      setError('プランの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [listPlans, currentPage, sortBy, sortOrder, search, platformFilter, statusFilter]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const handleSearch = () => {
    setCurrentPage(1);
    loadPlans();
  };

  const handleReset = () => {
    setSearch('');
    setPlatformFilter('');
    setStatusFilter('');
    setSortBy('created_at');
    setSortOrder('desc');
    setCurrentPage(1);
  };

  const handleSort = (field: 'created_at' | 'internal_name' | 'status') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setCurrentPage(1);
  };

  const getPlatformBadgeColor = (platform: string) => {
    switch (platform) {
      case 'stripe':
        return 'bg-blue-100 text-blue-800';
      case 'apple':
        return 'bg-gray-800 text-white';
      case 'google':
        return 'bg-green-100 text-green-800';
      case 'internal':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
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

  if (loading && !planData) {
    return <LoadingOverlay>プランを読み込み中...</LoadingOverlay>;
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 xl:px-12 2xl:px-32">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                <PiCreditCard className="mr-3 inline text-3xl text-blue-600" />
                プラン管理
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                システムで提供するプランを管理します
              </p>
            </div>
            <div className="flex space-x-3">
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={() => navigate('/admin/billing/plans/create')}>
                <PiPlus className="mr-2" />
                新しいプランを作成
              </Button>
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

        {/* Statistics */}
        {planData && (
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-white p-6 shadow">
              <div className="text-2xl font-semibold text-gray-900">
                {planData.statistics.total_plans}
              </div>
              <div className="text-sm text-gray-600">全プラン数</div>
            </div>
            <div className="rounded-lg border bg-white p-6 shadow">
              <div className="text-2xl font-semibold text-green-600">
                {planData.statistics.active_plans}
              </div>
              <div className="text-sm text-gray-600">新規加入可能</div>
            </div>
            <div className="rounded-lg border bg-white p-6 shadow">
              <div className="text-2xl font-semibold text-yellow-600">
                {planData.statistics.closed_to_new_plans}
              </div>
              <div className="text-sm text-gray-600">新規受付終了</div>
            </div>
            <div className="rounded-lg border bg-white p-6 shadow">
              <div className="text-2xl font-semibold text-red-600">
                {planData.statistics.deprecated_plans}
              </div>
              <div className="text-sm text-gray-600">廃止済み</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mb-6 rounded-lg bg-white p-6 shadow">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                検索
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="内部名称、表示名で検索"
                  className="w-full rounded border border-gray-300 px-3 py-2 pr-10"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleSearch();
                    }
                  }}
                />
                <PiMagnifyingGlass className="absolute right-3 top-3 text-gray-400" />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                プラットフォーム
              </label>
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2">
                <option value="">すべて</option>
                <option value="stripe">Stripe</option>
                <option value="apple">Apple</option>
                <option value="google">Google</option>
                <option value="internal">Internal</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                ステータス
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2">
                <option value="">すべて</option>
                <option value="active">新規加入可能</option>
                <option value="closed_to_new">新規受付終了</option>
                <option value="deprecated">廃止済み</option>
              </select>
            </div>
            <div className="flex items-end space-x-2">
              <Button onClick={handleSearch} className="flex-1">
                検索
              </Button>
              <Button outlined onClick={handleReset}>
                リセット
              </Button>
            </div>
          </div>
        </div>

        {/* Plans Table */}
        <div className="rounded-lg bg-white shadow">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">プラン一覧</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    プランID
                  </th>
                  <th
                    className="cursor-pointer px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    onClick={() => handleSort('internal_name')}>
                    内部名称 {sortBy === 'internal_name' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    表示名
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    プラットフォーム
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                    デフォルト
                  </th>
                  <th
                    className="cursor-pointer px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    onClick={() => handleSort('status')}>
                    ステータス {sortBy === 'status' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="cursor-pointer px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    onClick={() => handleSort('created_at')}>
                    作成日時 {sortBy === 'created_at' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {planData && planData.plans.length > 0 ? (
                  planData.plans.map((plan: PlanListItem) => (
                    <tr key={plan.plan_id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="text-sm text-gray-500" title={plan.plan_id}>
                          {plan.plan_id.substring(0, 8)}...
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div
                          className="cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-800"
                          onClick={() => navigate(`/admin/billing/plans/${plan.plan_id}`)}>
                          {plan.internal_name}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="text-sm text-gray-900">{plan.display_name}</div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2 text-xs font-semibold ${getPlatformBadgeColor(plan.platform_type)}`}>
                          {plan.platform_type}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-center">
                        {plan.is_default && (
                          <PiCheckCircle className="inline text-green-600" size={20} title="デフォルトプラン" />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2 text-xs font-semibold ${getStatusBadgeColor(plan.status)}`}>
                          {getStatusLabel(plan.status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {new Date(plan.created_at).toLocaleDateString('ja-JP')}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                        <Button
                          outlined
                          onClick={() => navigate(`/admin/billing/plans/${plan.plan_id}`)}>
                          詳細を見る
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                      プランが見つかりません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {planData && planData.pagination.total_pages > 1 && (
            <div className="border-t border-gray-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  {planData.pagination.total_count}件中{' '}
                  {(planData.pagination.current_page - 1) * planData.pagination.limit + 1}-
                  {Math.min(
                    planData.pagination.current_page * planData.pagination.limit,
                    planData.pagination.total_count
                  )}
                  件を表示
                </div>
                <div className="flex space-x-2">
                  <Button
                    outlined
                    disabled={!planData.pagination.has_previous}
                    onClick={() => setCurrentPage(currentPage - 1)}>
                    前へ
                  </Button>
                  <div className="flex items-center px-4 text-sm text-gray-700">
                    ページ {planData.pagination.current_page} / {planData.pagination.total_pages}
                  </div>
                  <Button
                    outlined
                    disabled={!planData.pagination.has_next}
                    onClick={() => setCurrentPage(currentPage + 1)}>
                    次へ
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlanManagementPage;
