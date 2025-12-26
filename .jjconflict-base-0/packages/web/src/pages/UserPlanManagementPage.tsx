import React, { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { PiUsers, PiMagnifyingGlass, PiCreditCard } from 'react-icons/pi';
import Button from '../components/Button';
import Alert from '../components/Alert';
import LoadingOverlay from '../components/LoadingOverlay';
import useHttp from '../hooks/useHttp';
import usePlanApi, { PlanListItem } from '../hooks/usePlanApi';

interface AdminStatusResponse {
  isAdmin: boolean;
  tenantId: string;
  username: string;
}

interface TenantUser {
  username: string;
  email: string;
  tenantId: string;
  tenantAdmin: boolean;
  enabled: boolean;
  userStatus: string;
  createdDate: string;
  lastModifiedDate: string;
}

const UserPlanManagementPage: React.FC = () => {
  const { api } = useHttp();
  const { listPlans, applyPlanToUser } = usePlanApi();

  const [adminStatus, setAdminStatus] = useState<AdminStatusResponse | null>(
    null
  );
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [internalPlans, setInternalPlans] = useState<PlanListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filteredUsers, setFilteredUsers] = useState<TenantUser[]>([]);
  const [applyingUsernames, setApplyingUsernames] = useState<Set<string>>(
    new Set()
  );
  const [selectedPlans, setSelectedPlans] = useState<Map<string, string>>(
    new Map()
  );

  const loadUsers = useCallback(async () => {
    try {
      const response = await api.get('/admin/users');
      setUsers(response.data.users || []);
    } catch (error) {
      console.error('Failed to load users:', error);
      setError('ユーザー一覧の読み込みに失敗しました');
    }
  }, [api]);

  const loadInternalPlans = useCallback(async () => {
    try {
      const data = await listPlans({
        platform_type: 'internal',
        status: 'active',
        limit: 100,
      });
      setInternalPlans(data.plans);
    } catch (error) {
      console.error('Failed to load internal plans:', error);
      setError('プラン一覧の読み込みに失敗しました');
    }
  }, [listPlans]);

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const response = await api.get('/admin/status');
        setAdminStatus(response.data);

        if (response.data.isAdmin) {
          await Promise.all([loadUsers(), loadInternalPlans()]);
        }
      } catch (error) {
        console.error('Failed to check admin status:', error);
        setError('管理者権限の確認に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    checkAdminStatus();
  }, [api, loadUsers, loadInternalPlans]);

  useEffect(() => {
    if (!search) {
      setFilteredUsers(users);
    } else {
      const searchLower = search.toLowerCase();
      setFilteredUsers(
        users.filter(
          (user) =>
            user.email.toLowerCase().includes(searchLower) ||
            user.username.toLowerCase().includes(searchLower)
        )
      );
    }
  }, [users, search]);

  const handleApplyPlan = async (username: string) => {
    const planId = selectedPlans.get(username);
    if (!planId) {
      setError('プランを選択してください');
      return;
    }

    setApplyingUsernames((prev) => new Set(prev).add(username));
    setError(null);
    setSuccess(null);

    try {
      await applyPlanToUser(username, { planId });
      const plan = internalPlans.find((p) => p.plan_id === planId);
      setSuccess(
        `${username} を「${plan?.internal_name || planId}」プランに適用しました`
      );
      setTimeout(() => setSuccess(null), 5000);
    } catch (error: any) {
      console.error('Failed to apply plan:', error);
      const errorMessage =
        error?.response?.data?.message || 'プランの適用に失敗しました';
      setError(errorMessage);
    } finally {
      setApplyingUsernames((prev) => {
        const newSet = new Set(prev);
        newSet.delete(username);
        return newSet;
      });
    }
  };

  const handlePlanSelect = (username: string, planId: string) => {
    setSelectedPlans((prev) => new Map(prev).set(username, planId));
  };

  if (!loading && (!adminStatus || !adminStatus.isAdmin)) {
    return <Navigate to="/settings" replace />;
  }

  if (loading) {
    return <LoadingOverlay>読み込み中...</LoadingOverlay>;
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 xl:px-12 2xl:px-32">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                <PiUsers className="mr-3 inline text-3xl text-blue-600" />
                ユーザープラン管理
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                ユーザーを個別で内部プランに適用します
              </p>
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

        {/* Statistics */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border bg-white p-6 shadow">
            <div className="flex items-center">
              <PiUsers className="h-8 w-8 text-blue-600" />
              <div className="ml-4">
                <div className="text-2xl font-semibold text-gray-900">
                  {users.length}
                </div>
                <div className="text-sm text-gray-600">総ユーザー数</div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-6 shadow">
            <div className="flex items-center">
              <PiCreditCard className="h-8 w-8 text-purple-600" />
              <div className="ml-4">
                <div className="text-2xl font-semibold text-gray-900">
                  {internalPlans.length}
                </div>
                <div className="text-sm text-gray-600">
                  適用可能なInternalプラン
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-6 shadow">
            <div className="flex items-center">
              <PiUsers className="h-8 w-8 text-green-600" />
              <div className="ml-4">
                <div className="text-2xl font-semibold text-gray-900">
                  {filteredUsers.length}
                </div>
                <div className="text-sm text-gray-600">検索結果</div>
              </div>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6 rounded-lg bg-white p-6 shadow">
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <label className="mb-2 block text-sm font-medium text-gray-700">
                ユーザー検索
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="メールアドレスまたはユーザー名で検索"
                  className="w-full rounded border border-gray-300 px-3 py-2 pr-10"
                />
                <PiMagnifyingGlass className="absolute right-3 top-3 text-gray-400" />
              </div>
            </div>
            <div className="pt-6">
              <Button outlined onClick={() => setSearch('')}>
                クリア
              </Button>
            </div>
          </div>
        </div>

        {/* No Internal Plans Warning */}
        {internalPlans.length === 0 && (
          <div className="mb-6">
            <Alert severity="warning" className="w-full">
              適用可能なInternalプランがありません。プラン管理ページからInternalプラン（status:
              active）を作成してください。
            </Alert>
          </div>
        )}

        {/* Users Table */}
        <div className="rounded-lg bg-white shadow">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              ユーザー一覧
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    ユーザー
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    ステータス
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    作成日
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    適用するプラン
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {filteredUsers.map((user) => (
                  <tr key={user.username} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {user.email}
                        </div>
                        <div className="text-sm text-gray-500">
                          {user.username}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2 text-xs font-semibold ${
                          user.enabled
                            ? user.userStatus === 'CONFIRMED'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                        {user.enabled ? user.userStatus : '無効'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {new Date(user.createdDate).toLocaleDateString('ja-JP')}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <select
                        value={selectedPlans.get(user.username) || ''}
                        onChange={(e) =>
                          handlePlanSelect(user.username, e.target.value)
                        }
                        disabled={
                          applyingUsernames.has(user.username) ||
                          internalPlans.length === 0
                        }
                        className="w-48 rounded border border-gray-300 px-2 py-1 text-sm disabled:cursor-not-allowed disabled:bg-gray-100">
                        <option value="">プランを選択</option>
                        {internalPlans.map((plan) => (
                          <option key={plan.plan_id} value={plan.plan_id}>
                            {plan.internal_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                      <Button
                        onClick={() => handleApplyPlan(user.username)}
                        disabled={
                          applyingUsernames.has(user.username) ||
                          !selectedPlans.get(user.username) ||
                          internalPlans.length === 0
                        }
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300">
                        {applyingUsernames.has(user.username)
                          ? '適用中...'
                          : 'プランを適用'}
                      </Button>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-12 text-center text-gray-500">
                      {search
                        ? '検索条件に一致するユーザーが見つかりません'
                        : 'ユーザーが見つかりません'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserPlanManagementPage;
