import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';
import {
  PiCaretLeft,
  PiCheckCircle,
  PiXCircle,
  PiSpinnerGap,
  PiEnvelope,
  PiEnvelopeOpen,
  PiChatCircleText,
  PiClock,
  PiCoins,
} from 'react-icons/pi';
import useSchedulerApi from '../../hooks/useSchedulerApi';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Markdown from '../../components/Markdown';

const SchedulerExecutionDetailPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { taskId, executionId: rawExecutionId } = useParams<{
    taskId: string;
    executionId: string;
  }>();
  const executionId = rawExecutionId
    ? decodeURIComponent(rawExecutionId)
    : undefined;

  const api = useSchedulerApi();
  const { data: taskData } = api.getTask(taskId ?? null);
  const { data: execData } = api.getExecution(
    taskId ?? null,
    executionId ?? null
  );

  const task = taskData?.task;
  const execution = execData?.execution;

  if (!execution) {
    return (
      <div className="flex items-center justify-center p-16">
        <PiSpinnerGap className="animate-spin text-2xl text-gray-400" />
      </div>
    );
  }

  const isSuccess = execution.status === 'success';
  const isError = execution.status === 'error';
  const isRunning = execution.status === 'running';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          className="rounded p-1 hover:bg-gray-100"
          onClick={() => navigate(`/scheduler/${taskId}`)}>
          <PiCaretLeft className="text-xl" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">
            {task?.taskName ?? t('scheduler.execution_result')}
          </h1>
          <div className="text-xs text-gray-400">
            {format(parseISO(execution.startedAt), 'yyyy/MM/dd HH:mm:ss')}
          </div>
        </div>
      </div>

      {/* Status Banner */}
      <div
        className={`flex items-center gap-3 rounded-lg border p-4 ${
          isSuccess
            ? 'border-green-200 bg-green-50'
            : isError
              ? 'border-red-200 bg-red-50'
              : 'border-blue-200 bg-blue-50'
        }`}>
        {isSuccess && <PiCheckCircle className="text-2xl text-green-500" />}
        {isError && <PiXCircle className="text-2xl text-red-500" />}
        {isRunning && (
          <PiSpinnerGap className="animate-spin text-2xl text-blue-500" />
        )}
        <div>
          <div
            className={`font-medium ${
              isSuccess
                ? 'text-green-700'
                : isError
                  ? 'text-red-700'
                  : 'text-blue-700'
            }`}>
            {isSuccess && t('scheduler.status_success')}
            {isError && t('scheduler.status_error')}
            {isRunning && t('scheduler.status_running')}
          </div>
          {execution.completedAt && (
            <div className="text-xs text-gray-500">
              {t('scheduler.completed_at', {
                time: format(parseISO(execution.completedAt), 'HH:mm:ss'),
              })}
            </div>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Duration */}
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-3">
          <PiClock className="text-gray-400" />
          <div>
            <div className="text-xs text-gray-400">
              {t('scheduler.execution_time')}
            </div>
            <div className="text-sm">
              {execution.completedAt
                ? t('scheduler.execution_time_seconds', {
                    seconds: Math.round(
                      (parseISO(execution.completedAt).getTime() -
                        parseISO(execution.startedAt).getTime()) /
                        1000
                    ),
                  })
                : '-'}
            </div>
          </div>
        </div>

        {/* Tokens */}
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-3">
          <PiCoins className="text-gray-400" />
          <div>
            <div className="text-xs text-gray-400">{t('scheduler.tokens')}</div>
            <div className="text-sm">
              {execution.tokenUsage
                ? t('scheduler.tokens_detail', {
                    input: execution.tokenUsage.inputTokens.toLocaleString(),
                    output: execution.tokenUsage.outputTokens.toLocaleString(),
                  })
                : '-'}
            </div>
          </div>
        </div>

        {/* Email */}
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-3">
          {execution.emailSent ? (
            <PiEnvelopeOpen className="text-green-500" />
          ) : (
            <PiEnvelope className="text-gray-400" />
          )}
          <div>
            <div className="text-xs text-gray-400">
              {t('scheduler.email_notification')}
            </div>
            <div className="text-sm">
              {execution.emailSent
                ? t('scheduler.email_sent')
                : t('scheduler.email_unsent')}
            </div>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {isError && execution.errorMessage && (
        <Card label={t('scheduler.error_content')}>
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {execution.errorMessage}
          </div>
        </Card>
      )}

      {/* Result Text */}
      {execution.resultText && (
        <Card label={t('scheduler.prompt')}>
          <div className="prose prose-sm max-h-[600px] max-w-none overflow-y-auto">
            <Markdown>{execution.resultText}</Markdown>
          </div>
        </Card>
      )}

      {/* Deep-dive chat button */}
      {isSuccess && execution.resultText && (
        <div className="flex justify-center pb-8">
          <Button
            onClick={() => {
              // Navigate to chat with execution context as initial message
              const contextMessage = `${t('scheduler.execution_result')}: ${task?.taskName ?? ''}\n\n---\n${execution.resultText}\n---\n\n`;
              // Store in sessionStorage for the chat page to pick up
              sessionStorage.setItem('scheduler-chat-context', contextMessage);
              navigate('/chat');
            }}>
            <PiChatCircleText className="mr-1" />
            {t('scheduler.chat_deep_dive')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default SchedulerExecutionDetailPage;
