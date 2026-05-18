import React, { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';
import {
  PiCaretLeft,
  PiPencilSimple,
  PiTrash,
  PiCheckCircle,
  PiXCircle,
  PiSpinnerGap,
  PiCalendarBlank,
  PiRobot,
  PiClock,
} from 'react-icons/pi';
import useSchedulerApi from '../../hooks/useSchedulerApi';
import { formatScheduleLabel } from './schedulerUtils';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Switch from '../../components/Switch';
import ModalDialog from '../../components/ModalDialog';
import Alert from '../../components/Alert';

const SchedulerTaskDetailPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();

  const api = useSchedulerApi();
  const { data: taskData, mutate: mutateTask } = api.getTask(taskId ?? null);
  const { data: execData } = api.listExecutions(taskId ?? null, 20);

  const task = taskData?.task;
  const executions = execData?.executions ?? [];

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = (status: string) => {
    switch (status) {
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 text-green-600">
            <PiCheckCircle /> {t('scheduler.status_success')}
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 text-red-600">
            <PiXCircle /> {t('scheduler.status_error')}
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center gap-1 text-blue-600">
            <PiSpinnerGap className="animate-spin" />{' '}
            {t('scheduler.status_running')}
          </span>
        );
      default:
        return (
          <span className="text-gray-400">{t('scheduler.status_unknown')}</span>
        );
    }
  };

  const handleToggleEnabled = useCallback(
    async (newValue: boolean) => {
      if (!taskId) return;
      try {
        await api.updateTask(taskId, { enabled: newValue });
        mutateTask();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        setError(t('scheduler.error_update_status_failed'));
      }
    },
    [taskId, api, mutateTask, t]
  );

  const handleDelete = useCallback(async () => {
    if (!taskId) return;
    setDeleting(true);
    try {
      await api.deleteTask(taskId);
      navigate('/scheduler');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(t('scheduler.error_delete_failed'));
      setDeleting(false);
      setDeleteOpen(false);
    }
  }, [taskId, api, navigate, t]);

  if (!task) {
    return (
      <div className="flex items-center justify-center p-16">
        <PiSpinnerGap className="animate-spin text-2xl text-gray-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          className="rounded p-1 hover:bg-gray-100"
          onClick={() => navigate('/scheduler')}>
          <PiCaretLeft className="text-xl" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{task.taskName}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            outlined
            onClick={() => navigate(`/scheduler/${taskId}/edit`)}>
            <PiPencilSimple className="mr-1" />
            {t('scheduler.edit')}
          </Button>
          <Button outlined onClick={() => setDeleteOpen(true)}>
            <PiTrash className="mr-1" />
            {t('scheduler.delete')}
          </Button>
        </div>
      </div>

      {error && (
        <Alert severity="error" onDissmiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Task Info */}
      <Card>
        <div className="flex flex-col gap-4">
          {/* Enable/Disable */}
          <div className="flex items-center justify-between">
            <Switch
              checked={task.enabled}
              onSwitch={handleToggleEnabled}
              label={
                task.enabled ? t('scheduler.enabled') : t('scheduler.disabled')
              }
            />
          </div>

          {/* Details grid */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <PiCalendarBlank className="mt-0.5 shrink-0 text-gray-400" />
              <div>
                <div className="text-xs text-gray-400">
                  {t('scheduler.schedule')}
                </div>
                <div className="text-sm">
                  {formatScheduleLabel(task.schedule, t)}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <PiRobot className="mt-0.5 shrink-0 text-gray-400" />
              <div>
                <div className="text-xs text-gray-400">
                  {t('scheduler.agent')}
                </div>
                <div className="text-sm">{task.agentName}</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <PiClock className="mt-0.5 shrink-0 text-gray-400" />
              <div>
                <div className="text-xs text-gray-400">
                  {t('scheduler.last_updated')}
                </div>
                <div className="text-sm">
                  {format(parseISO(task.updatedAt), 'yyyy/MM/dd HH:mm')}
                </div>
              </div>
            </div>
          </div>

          {/* Prompt */}
          <div>
            <div className="mb-1 text-xs text-gray-400">
              {t('scheduler.prompt')}
            </div>
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-gray-100 bg-gray-50 p-3 text-sm">
              {task.prompt}
            </div>
          </div>
        </div>
      </Card>

      {/* Execution History */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-600">
          {t('scheduler.execution_history')}
        </h2>
        {executions.length === 0 ? (
          <div className="rounded-lg border border-gray-200 py-8 text-center text-sm text-gray-400">
            {t('scheduler.no_execution_history')}
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200">
            {executions.map((exec, idx) => (
              <button
                key={exec.executionId}
                className={`flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-gray-50 ${
                  idx > 0 ? 'border-t border-gray-100' : ''
                }`}
                onClick={() =>
                  navigate(
                    `/scheduler/${taskId}/executions/${encodeURIComponent(exec.executionId)}`
                  )
                }>
                <div className="text-lg">{statusLabel(exec.status)}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    {format(parseISO(exec.startedAt), 'yyyy/MM/dd HH:mm')}
                  </div>
                  {exec.completedAt && (
                    <div className="text-xs text-gray-400">
                      {t('scheduler.completed_at', {
                        time: format(parseISO(exec.completedAt), 'HH:mm:ss'),
                      })}
                    </div>
                  )}
                </div>
                <PiCaretLeft className="rotate-180 text-gray-300" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <ModalDialog
        isOpen={deleteOpen}
        title={t('scheduler.delete_task')}
        onClose={() => setDeleteOpen(false)}>
        <div className="flex flex-col gap-4">
          <p>
            {t('scheduler.delete_confirm_message', { name: task.taskName })}
          </p>
          <div className="flex justify-end gap-3">
            <Button outlined onClick={() => setDeleteOpen(false)}>
              {t('scheduler.cancel')}
            </Button>
            <Button onClick={handleDelete} loading={deleting}>
              <PiTrash className="mr-1" />
              {t('scheduler.delete')}
            </Button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
};

export default SchedulerTaskDetailPage;
