import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PiArrowsClockwise, PiMagnifyingGlass, PiCaretRight } from 'react-icons/pi';
import Button from '../components/Button';
import Alert from '../components/Alert';
import LoadingOverlay from '../components/LoadingOverlay';
import useFlowExecutionApi, {
  FlowExecutionListItem,
  ListFlowExecutionsResponse,
  FlowType,
  FlowExecutionStatus,
} from '../hooks/useFlowExecutionApi';

const FlowExecutionManagementPage: React.FC = () => {
  const navigate = useNavigate();
  const { listFlowExecutions } = useFlowExecutionApi();

  const [data, setData] = useState<ListFlowExecutionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [statusFilter, setStatusFilter] = useState<FlowExecutionStatus | ''>('');
  const [flowTypeFilter, setFlowTypeFilter] = useState<FlowType | ''>('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Pagination state
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [tokenHistory, setTokenHistory] = useState<(string | null)[]>([null]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  const loadFlowExecutions = useCallback(async (token?: string | null) => {
    try {
      setLoading(true);
      setError(null);

      const params: Parameters<typeof listFlowExecutions>[0] = {
        limit: 20,
      };

      if (token) params.next_token = token;
      if (statusFilter) params.status = statusFilter;
      if (flowTypeFilter) params.flow_type = flowTypeFilter;
      if (userIdFilter) params.user_id = userIdFilter;
      if (fromDate) params.from_date = new Date(fromDate).toISOString();
      if (toDate) params.to_date = new Date(toDate + 'T23:59:59').toISOString();

      const result = await listFlowExecutions(params);
      setData(result);
      setNextToken(result.pagination.next_token);
    } catch (err) {
      console.error('Failed to load flow executions:', err);
      setError('フロー実行履歴の読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [listFlowExecutions, statusFilter, flowTypeFilter, userIdFilter, fromDate, toDate]);

  useEffect(() => {
    loadFlowExecutions();
  }, []);

  const handleSearch = () => {
    setTokenHistory([null]);
    setCurrentPageIndex(0);
    setNextToken(null);
    loadFlowExecutions();
  };

  const handleReset = () => {
    setStatusFilter('');
    setFlowTypeFilter('');
    setUserIdFilter('');
    setFromDate('');
    setToDate('');
    setTokenHistory([null]);
    setCurrentPageIndex(0);
    setNextToken(null);
  };

  const handleNextPage = () => {
    if (nextToken) {
      const newHistory = [...tokenHistory];
      if (currentPageIndex === tokenHistory.length - 1) {
        newHistory.push(nextToken);
        setTokenHistory(newHistory);
      }
      setCurrentPageIndex(currentPageIndex + 1);
      loadFlowExecutions(nextToken);
    }
  };

  const handlePrevPage = () => {
    if (currentPageIndex > 0) {
      const prevToken = tokenHistory[currentPageIndex - 1];
      setCurrentPageIndex(currentPageIndex - 1);
      loadFlowExecutions(prevToken);
    }
  };

  const getStatusBadgeColor = (status: FlowExecutionStatus) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'rolled_back':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: FlowExecutionStatus) => {
    switch (status) {
      case 'completed':
        return '完了';
      case 'in_progress':
        return '実行中';
      case 'failed':
        return '失敗';
      case 'rolled_back':
        return 'ロールバック済';
      default:
        return status;
    }
  };

  const getFlowTypeLabel = (flowType: FlowType) => {
    switch (flowType) {
      case 'purchase':
        return '購入';
      case 'plan_change':
        return 'プラン変更';
      case 'cancellation':
        return '解約';
      case 'webhook_event':
        return 'Webhookイベント';
      default:
        return flowType;
    }
  };

  const getFlowTypeBadgeColor = (flowType: FlowType) => {
    switch (flowType) {
      case 'purchase':
        return 'bg-purple-100 text-purple-800';
      case 'plan_change':
        return 'bg-blue-100 text-blue-800';
      case 'cancellation':
        return 'bg-orange-100 text-orange-800';
      case 'webhook_event':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  if (loading && !data) {
    return <LoadingOverlay>フロー実行履歴を読み込み中...</LoadingOverlay>;
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 xl:px-12 2xl:px-32">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                <PiArrowsClockwise className="mr-3 inline text-3xl text-blue-600" />
                フロー実行履歴
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                Webhookイベントや課金処理のフロー実行履歴を確認できます
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

        {/* Filters */}
        <div className="mb-6 rounded-lg bg-white p-6 shadow">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                ステータス
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as FlowExecutionStatus | '')}
                className="w-full rounded border border-gray-300 px-3 py-2">
                <option value="">すべて</option>
                <option value="completed">完了</option>
                <option value="in_progress">実行中</option>
                <option value="failed">失敗</option>
                <option value="rolled_back">ロールバック済</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                フロータイプ
              </label>
              <select
                value={flowTypeFilter}
                onChange={(e) => setFlowTypeFilter(e.target.value as FlowType | '')}
                className="w-full rounded border border-gray-300 px-3 py-2">
                <option value="">すべて</option>
                <option value="webhook_event">Webhookイベント</option>
                <option value="purchase">購入</option>
                <option value="plan_change">プラン変更</option>
                <option value="cancellation">解約</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                ユーザーID
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={userIdFilter}
                  onChange={(e) => setUserIdFilter(e.target.value)}
                  placeholder="完全一致"
                  className="w-full rounded border border-gray-300 px-3 py-2 pr-10"
                />
                <PiMagnifyingGlass className="absolute right-3 top-3 text-gray-400" />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                開始日（から）
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                開始日（まで）
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2"
              />
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

        {/* Flow Executions Table */}
        <div className="rounded-lg bg-white shadow">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">実行履歴一覧</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    実行ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    フロータイプ
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    ユーザーID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    ステータス
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    進捗
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    開始日時
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    実行時間
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {data && data.flow_executions.length > 0 ? (
                  data.flow_executions.map((item: FlowExecutionListItem) => (
                    <tr
                      key={item.flow_execution_id}
                      className={`hover:bg-gray-50 ${item.has_error ? 'bg-red-50' : ''}`}>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div
                          className="cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-800"
                          onClick={() =>
                            navigate(`/admin/billing/flow-executions/${item.flow_execution_id}`)
                          }
                          title={item.flow_execution_id}>
                          {item.flow_execution_id.substring(0, 8)}...
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2 text-xs font-semibold ${getFlowTypeBadgeColor(item.flow_type)}`}>
                          {getFlowTypeLabel(item.flow_type)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="text-sm text-gray-900" title={item.user_id || '-'}>
                          {item.user_id ? `${item.user_id.substring(0, 12)}...` : '-'}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2 text-xs font-semibold ${getStatusBadgeColor(item.status)}`}>
                          {getStatusLabel(item.status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {item.completed_steps !== null && item.total_steps !== null
                          ? `${item.completed_steps}/${item.total_steps}`
                          : '-'}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {new Date(item.started_at).toLocaleString('ja-JP')}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {formatDuration(item.duration)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                        <Button
                          outlined
                          onClick={() =>
                            navigate(`/admin/billing/flow-executions/${item.flow_execution_id}`)
                          }>
                          <PiCaretRight className="mr-1" />
                          詳細
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                      フロー実行履歴が見つかりません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="border-t border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                ページ {currentPageIndex + 1}
              </div>
              <div className="flex space-x-2">
                <Button
                  outlined
                  disabled={currentPageIndex === 0}
                  onClick={handlePrevPage}>
                  前へ
                </Button>
                <Button
                  outlined
                  disabled={!data?.pagination.has_next}
                  onClick={handleNextPage}>
                  次へ
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FlowExecutionManagementPage;
