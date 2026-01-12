import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  PiArrowLeft,
  PiCheckCircle,
  PiXCircle,
  PiSpinner,
  PiArrowCounterClockwise,
  PiCaretDown,
  PiCaretRight,
} from 'react-icons/pi';
import Button from '../components/Button';
import Alert from '../components/Alert';
import LoadingOverlay from '../components/LoadingOverlay';
import useFlowExecutionApi, {
  GetFlowExecutionResponse,
  FlowType,
  FlowExecutionStatus,
  StepStatus,
} from '../hooks/useFlowExecutionApi';

const FlowExecutionDetailPage: React.FC = () => {
  const { flowExecutionId } = useParams<{ flowExecutionId: string }>();
  const navigate = useNavigate();
  const { getFlowExecution } = useFlowExecutionApi();

  const [data, setData] = useState<GetFlowExecutionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  const loadFlowExecution = useCallback(async () => {
    if (!flowExecutionId) return;

    try {
      setLoading(true);
      setError(null);
      const result = await getFlowExecution(flowExecutionId);
      setData(result);

      // 失敗したステップを自動展開
      const failedSteps = new Set<number>();
      result.step_executions.forEach((step) => {
        if (step.status === 'failed') {
          failedSteps.add(step.step_sequence);
        }
      });
      setExpandedSteps(failedSteps);
    } catch (err) {
      console.error('Failed to load flow execution:', err);
      setError('フロー実行履歴の読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [flowExecutionId, getFlowExecution]);

  useEffect(() => {
    loadFlowExecution();
  }, [loadFlowExecution]);

  const toggleStepExpanded = (stepSequence: number) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepSequence)) {
      newExpanded.delete(stepSequence);
    } else {
      newExpanded.add(stepSequence);
    }
    setExpandedSteps(newExpanded);
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

  const getStepStatusIcon = (status: StepStatus) => {
    switch (status) {
      case 'completed':
        return <PiCheckCircle className="text-green-500" size={20} />;
      case 'in_progress':
        return <PiSpinner className="animate-spin text-blue-500" size={20} />;
      case 'failed':
        return <PiXCircle className="text-red-500" size={20} />;
      case 'skipped':
        return <PiArrowCounterClockwise className="text-gray-400" size={20} />;
      default:
        return <div className="h-5 w-5 rounded-full border-2 border-gray-300" />;
    }
  };

  const getStepStatusLabel = (status: StepStatus) => {
    switch (status) {
      case 'completed':
        return '完了';
      case 'in_progress':
        return '実行中';
      case 'failed':
        return '失敗';
      case 'skipped':
        return 'スキップ';
      case 'pending':
        return '待機中';
      default:
        return status;
    }
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatJson = (obj: Record<string, unknown> | null) => {
    if (!obj) return '-';
    return JSON.stringify(obj, null, 2);
  };

  if (loading) {
    return <LoadingOverlay>フロー実行履歴を読み込み中...</LoadingOverlay>;
  }

  if (error || !data) {
    return (
      <div className="px-4 py-6 sm:px-6 lg:px-8 xl:px-12 2xl:px-32">
        <div className="mx-auto max-w-7xl">
          <Alert severity="error" className="w-full">
            {error || 'データの読み込みに失敗しました'}
          </Alert>
          <div className="mt-4">
            <Button onClick={() => navigate('/admin/billing/flow-executions')}>
              <PiArrowLeft className="mr-2" />
              一覧に戻る
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { flow_execution, step_executions } = data;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 xl:px-12 2xl:px-32">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <Button
            outlined
            onClick={() => navigate('/admin/billing/flow-executions')}
            className="mb-4">
            <PiArrowLeft className="mr-2" />
            一覧に戻る
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">フロー実行詳細</h1>
              <p className="mt-1 text-sm text-gray-500">
                ID: {flow_execution.flow_execution_id}
              </p>
            </div>
            <span
              className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${getStatusBadgeColor(flow_execution.status)}`}>
              {getStatusLabel(flow_execution.status)}
            </span>
          </div>
        </div>

        {/* Flow Execution Info */}
        <div className="mb-6 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">概要</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <div className="text-sm font-medium text-gray-500">フロータイプ</div>
              <div className="mt-1 text-sm text-gray-900">
                {getFlowTypeLabel(flow_execution.flow_type)}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">ユーザーID</div>
              <div className="mt-1 text-sm text-gray-900">
                {flow_execution.user_id || '-'}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">開始者</div>
              <div className="mt-1 text-sm text-gray-900">
                {flow_execution.initiated_by}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">開始日時</div>
              <div className="mt-1 text-sm text-gray-900">
                {new Date(flow_execution.started_at).toLocaleString('ja-JP')}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">完了日時</div>
              <div className="mt-1 text-sm text-gray-900">
                {flow_execution.completed_at
                  ? new Date(flow_execution.completed_at).toLocaleString('ja-JP')
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">実行時間</div>
              <div className="mt-1 text-sm text-gray-900">
                {formatDuration(flow_execution.duration)}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">進捗</div>
              <div className="mt-1 text-sm text-gray-900">
                {flow_execution.completed_steps !== null && flow_execution.total_steps !== null
                  ? `${flow_execution.completed_steps}/${flow_execution.total_steps} ステップ`
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">現在のステップ</div>
              <div className="mt-1 text-sm text-gray-900">
                {flow_execution.current_step}
              </div>
            </div>
          </div>

          {/* Error Details */}
          {flow_execution.error_details && (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
              <h3 className="mb-2 text-sm font-semibold text-red-800">エラー詳細</h3>
              {flow_execution.error_details.error_code && (
                <div className="mb-1 text-sm text-red-700">
                  <span className="font-medium">エラーコード:</span>{' '}
                  {flow_execution.error_details.error_code}
                </div>
              )}
              <div className="text-sm text-red-700">
                <span className="font-medium">エラーメッセージ:</span>{' '}
                {flow_execution.error_details.error_message}
              </div>
              {flow_execution.error_details.stack_trace && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-red-700">
                    スタックトレース
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-red-100 p-2 text-xs text-red-800">
                    {flow_execution.error_details.stack_trace}
                  </pre>
                </details>
              )}
            </div>
          )}

          {/* Input Parameters */}
          <div className="mt-6">
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-gray-700">
                入力パラメータ
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-gray-100 p-4 text-xs text-gray-800">
                {formatJson(flow_execution.input_parameters)}
              </pre>
            </details>
          </div>

          {/* Output Result */}
          {flow_execution.output_result && (
            <div className="mt-4">
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-gray-700">
                  出力結果
                </summary>
                <pre className="mt-2 overflow-x-auto rounded bg-gray-100 p-4 text-xs text-gray-800">
                  {formatJson(flow_execution.output_result)}
                </pre>
              </details>
            </div>
          )}
        </div>

        {/* Step Executions */}
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">ステップ実行履歴</h2>
          <div className="space-y-2">
            {step_executions.map((step) => (
              <div
                key={step.step_sequence}
                className={`rounded-lg border ${
                  step.status === 'failed'
                    ? 'border-red-200 bg-red-50'
                    : 'border-gray-200 bg-white'
                }`}>
                <div
                  className="flex cursor-pointer items-center justify-between p-4"
                  onClick={() => toggleStepExpanded(step.step_sequence)}>
                  <div className="flex items-center space-x-4">
                    {getStepStatusIcon(step.status)}
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        Step {step.step_sequence}: {step.step_name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {step.step_type}
                        {step.target_service && ` - ${step.target_service}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <div className="text-sm text-gray-500">
                        {getStepStatusLabel(step.status)}
                      </div>
                      <div className="text-xs text-gray-400">
                        {formatDuration(step.duration)}
                        {step.retry_count > 0 && ` (リトライ: ${step.retry_count}回)`}
                      </div>
                    </div>
                    {expandedSteps.has(step.step_sequence) ? (
                      <PiCaretDown className="text-gray-400" />
                    ) : (
                      <PiCaretRight className="text-gray-400" />
                    )}
                  </div>
                </div>

                {expandedSteps.has(step.step_sequence) && (
                  <div className="border-t border-gray-200 p-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <div className="text-xs font-medium text-gray-500">開始日時</div>
                        <div className="text-sm text-gray-900">
                          {step.started_at
                            ? new Date(step.started_at).toLocaleString('ja-JP')
                            : '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-gray-500">完了日時</div>
                        <div className="text-sm text-gray-900">
                          {step.completed_at
                            ? new Date(step.completed_at).toLocaleString('ja-JP')
                            : '-'}
                        </div>
                      </div>
                    </div>

                    {/* Error Details */}
                    {step.error_details && (
                      <div className="mt-4 rounded border border-red-200 bg-red-50 p-3">
                        <div className="text-xs font-semibold text-red-800">エラー</div>
                        {step.error_details.error_code && (
                          <div className="text-xs text-red-700">
                            コード: {step.error_details.error_code}
                          </div>
                        )}
                        <div className="text-xs text-red-700">
                          {step.error_details.error_message}
                        </div>
                      </div>
                    )}

                    {/* Input Data */}
                    {step.input_data && (
                      <div className="mt-4">
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-gray-500">
                            入力データ
                          </summary>
                          <pre className="mt-2 overflow-x-auto rounded bg-gray-100 p-2 text-xs text-gray-800">
                            {formatJson(step.input_data)}
                          </pre>
                        </details>
                      </div>
                    )}

                    {/* Output Data */}
                    {step.output_data && (
                      <div className="mt-2">
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-gray-500">
                            出力データ
                          </summary>
                          <pre className="mt-2 overflow-x-auto rounded bg-gray-100 p-2 text-xs text-gray-800">
                            {formatJson(step.output_data)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FlowExecutionDetailPage;
