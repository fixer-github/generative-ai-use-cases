import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PiCaretLeft, PiFloppyDisk, PiWarning } from 'react-icons/pi';
import useSchedulerApi, {
  ScheduleConfig,
  ScheduleType,
  CreateScheduledTaskRequest,
} from '../../hooks/useSchedulerApi';
import { useAgentCore } from '../../hooks/useAgentCore';
import { MODELS } from '../../hooks/useModel';
import InputText from '../../components/InputText';
import Textarea from '../../components/Textarea';
import Select from '../../components/Select';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Alert from '../../components/Alert';

const SchedulerTaskFormPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();
  const isEdit = !!taskId;

  const api = useSchedulerApi();
  const { data: taskData } = api.getTask(taskId ?? null);

  const { getAllAvailableRuntimes } = useAgentCore('/scheduler-form');
  const runtimes = getAllAvailableRuntimes();

  // Form state
  const [taskName, setTaskName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agentName, setAgentName] = useState('');
  const [modelId, setModelId] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('daily');
  const [hour, setHour] = useState('09');
  const [minute, setMinute] = useState('00');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1]); // Default: Monday
  const [dayOfMonth, setDayOfMonth] = useState(1);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const DAY_OPTIONS = [
    { value: '1', label: t('scheduler.weekday_full_monday') },
    { value: '2', label: t('scheduler.weekday_full_tuesday') },
    { value: '3', label: t('scheduler.weekday_full_wednesday') },
    { value: '4', label: t('scheduler.weekday_full_thursday') },
    { value: '5', label: t('scheduler.weekday_full_friday') },
    { value: '6', label: t('scheduler.weekday_full_saturday') },
    { value: '7', label: t('scheduler.weekday_full_sunday') },
  ];

  const DAY_SHORT_LABELS: Record<string, string> = {
    '1': t('scheduler.day_monday'),
    '2': t('scheduler.day_tuesday'),
    '3': t('scheduler.day_wednesday'),
    '4': t('scheduler.day_thursday'),
    '5': t('scheduler.day_friday'),
    '6': t('scheduler.day_saturday'),
    '7': t('scheduler.day_sunday'),
  };

  const DAY_OF_MONTH_OPTIONS = Array.from({ length: 28 }, (_, i) => ({
    value: String(i + 1),
    label: t('scheduler.day_of_month_label', { day: i + 1 }),
  }));

  const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
    value: String(i).padStart(2, '0'),
    label: t('scheduler.hour_label', { hour: String(i).padStart(2, '0') }),
  }));

  const MINUTE_OPTIONS = [
    { value: '00', label: t('scheduler.minute_label', { minute: '00' }) },
    { value: '15', label: t('scheduler.minute_label', { minute: '15' }) },
    { value: '30', label: t('scheduler.minute_label', { minute: '30' }) },
    { value: '45', label: t('scheduler.minute_label', { minute: '45' }) },
  ];

  // Populate form for edit mode
  useEffect(() => {
    if (isEdit && taskData?.task) {
      const task = taskData.task;
      setTaskName(task.taskName);
      setPrompt(task.prompt);
      setAgentName(task.agentName);
      setModelId(task.modelId);
      setScheduleType(task.schedule.type);
      const [h, m] = task.schedule.time.split(':');
      setHour(h);
      setMinute(m);
      if (task.schedule.daysOfWeek) setDaysOfWeek(task.schedule.daysOfWeek);
      if (task.schedule.dayOfMonth) setDayOfMonth(task.schedule.dayOfMonth);
    }
  }, [isEdit, taskData]);

  // Set default agent (create mode only; edit mode populates from taskData)
  useEffect(() => {
    if (isEdit) return;
    if (!agentName && runtimes.length > 0) {
      setAgentName(runtimes[0].name);
    }
  }, [runtimes, agentName, isEdit]);

  // Set default model (create mode only; edit mode populates from taskData)
  useEffect(() => {
    if (isEdit) return;
    if (!modelId && MODELS.modelIds.length > 0) {
      setModelId(MODELS.modelIds[0]);
    }
  }, [modelId, isEdit]);

  const toggleDayOfWeek = useCallback((day: number) => {
    setDaysOfWeek((prev) => {
      if (prev.includes(day)) {
        const next = prev.filter((d) => d !== day);
        return next.length > 0 ? next : prev; // Keep at least one
      }
      return [...prev, day].sort();
    });
  }, []);

  const buildScheduleConfig = (): ScheduleConfig => {
    const config: ScheduleConfig = {
      type: scheduleType,
      time: `${hour}:${minute}`,
    };
    if (scheduleType === 'weekly') {
      config.daysOfWeek = daysOfWeek;
    }
    if (scheduleType === 'monthly') {
      config.dayOfMonth = dayOfMonth;
    }
    return config;
  };

  const validate = (): string | null => {
    if (!taskName.trim()) return t('scheduler.validation_name_required');
    if (!prompt.trim()) return t('scheduler.validation_prompt_required');
    if (!agentName) return t('scheduler.validation_agent_required');
    if (!modelId) return t('scheduler.validation_model_required');
    if (scheduleType === 'weekly' && daysOfWeek.length === 0)
      return t('scheduler.validation_days_required');
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const schedule = buildScheduleConfig();
      if (isEdit && taskId) {
        await api.updateTask(taskId, {
          taskName: taskName.trim(),
          prompt: prompt.trim(),
          agentName,
          modelId,
          schedule,
        });
        navigate(`/scheduler/${taskId}`);
      } else {
        const data: CreateScheduledTaskRequest = {
          taskName: taskName.trim(),
          prompt: prompt.trim(),
          agentName,
          modelId,
          schedule,
        };
        const res = await api.createTask(data);
        navigate(`/scheduler/${res.data.task.taskId}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        t('scheduler.error_save_failed');
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const agentOptions = runtimes.map((r) => ({
    value: r.name,
    label: r.name,
  }));

  const modelOptions = MODELS.modelIds.map((id) => ({
    value: id,
    label: MODELS.modelDisplayName(id),
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          className="rounded p-1 hover:bg-gray-100"
          onClick={() =>
            navigate(isEdit ? `/scheduler/${taskId}` : '/scheduler')
          }>
          <PiCaretLeft className="text-xl" />
        </button>
        <h1 className="text-xl font-semibold">
          {isEdit ? t('scheduler.edit_task') : t('scheduler.new_task_create')}
        </h1>
      </div>

      {error && (
        <Alert severity="error" onDissmiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Basic Info */}
      <Card label={t('scheduler.basic_info')}>
        <InputText
          label={t('scheduler.task_name')}
          required
          value={taskName}
          placeholder={t('scheduler.task_name_placeholder')}
          onChange={setTaskName}
          className="mb-3"
        />
        <Textarea
          label={t('scheduler.prompt')}
          required
          value={prompt}
          placeholder={t('scheduler.prompt_placeholder')}
          onChange={setPrompt}
          rows={5}
          maxHeight={400}
        />
      </Card>

      {/* Agent & Model */}
      <Card label={t('scheduler.execution_settings')}>
        <Select
          label={t('scheduler.agent')}
          value={agentName}
          options={agentOptions}
          onChange={setAgentName}
          fullWidth
          notItem
        />
        <div className="mt-3">
          <Select
            label={t('scheduler.model')}
            value={modelId}
            options={modelOptions}
            onChange={setModelId}
            fullWidth
            notItem
          />
        </div>
      </Card>

      {/* Schedule */}
      <Card label={t('scheduler.schedule')}>
        {/* Schedule Type */}
        <div className="mb-3">
          <span className="text-sm">{t('scheduler.repeat')}</span>
          <div className="mt-1 flex gap-2">
            {(
              [
                { value: 'daily', label: t('scheduler.repeat_daily') },
                { value: 'weekly', label: t('scheduler.repeat_weekly') },
                { value: 'monthly', label: t('scheduler.repeat_monthly') },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
                  scheduleType === opt.value
                    ? 'border-aws-smile bg-aws-smile/10 text-aws-smile font-medium'
                    : 'border-gray-300 hover:bg-gray-50'
                }`}
                onClick={() => setScheduleType(opt.value)}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Weekly: Day selection */}
        {scheduleType === 'weekly' && (
          <div className="mb-3">
            <span className="text-sm">{t('scheduler.days_of_week')}</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {DAY_OPTIONS.map((opt) => {
                const dayNum = parseInt(opt.value);
                const selected = daysOfWeek.includes(dayNum);
                return (
                  <button
                    key={opt.value}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      selected
                        ? 'border-aws-smile bg-aws-smile text-white'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                    onClick={() => toggleDayOfWeek(dayNum)}>
                    {DAY_SHORT_LABELS[opt.value]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Monthly: Day of month */}
        {scheduleType === 'monthly' && (
          <div className="mb-3">
            <Select
              label={t('scheduler.day_of_month')}
              value={String(dayOfMonth)}
              options={DAY_OF_MONTH_OPTIONS}
              onChange={(v) => setDayOfMonth(parseInt(v))}
              notItem
            />
          </div>
        )}

        {/* Time */}
        <div>
          {/* eslint-disable-next-line @shopify/jsx-no-hardcoded-content */}
          <span className="text-sm">{t('scheduler.execution_time')} (JST)</span>
          <div className="mt-1 flex items-center gap-2">
            <Select
              value={hour}
              options={HOUR_OPTIONS}
              onChange={setHour}
              notItem
            />
            <span className="text-lg">{t('scheduler.time_separator')}</span>
            <Select
              value={minute}
              options={MINUTE_OPTIONS}
              onChange={setMinute}
              notItem
            />
          </div>
        </div>
      </Card>

      {/* Notification info */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
        <PiWarning className="mt-0.5 shrink-0 text-sm" />
        <div>{t('scheduler.notification_info')}</div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pb-8">
        <Button
          outlined
          onClick={() =>
            navigate(isEdit ? `/scheduler/${taskId}` : '/scheduler')
          }>
          {t('scheduler.cancel')}
        </Button>
        <Button onClick={handleSubmit} loading={saving}>
          <PiFloppyDisk className="mr-1" />
          {isEdit ? t('scheduler.update') : t('scheduler.create')}
        </Button>
      </div>
    </div>
  );
};

export default SchedulerTaskFormPage;
