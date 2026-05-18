import React, { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  getDay,
  parseISO,
} from 'date-fns';
import { ja, enUS } from 'date-fns/locale';
import {
  PiCaretLeft,
  PiCaretRight,
  PiPlus,
  PiCalendarBlank,
  PiCheckCircle,
  PiXCircle,
  PiSpinnerGap,
  PiCircle,
} from 'react-icons/pi';
import useSchedulerApi, {
  ScheduledTaskResponse,
  TaskExecutionSummary,
} from '../../hooks/useSchedulerApi';
import { formatScheduleLabel } from './schedulerUtils';
import ButtonIcon from '../../components/ButtonIcon';
import Button from '../../components/Button';

type ViewMode = 'month' | 'week';

// Compute which days a task is scheduled to run
const getScheduledDays = (
  task: ScheduledTaskResponse,
  days: Date[]
): Set<string> => {
  const set = new Set<string>();
  if (!task.enabled) return set;
  const { schedule } = task;
  for (const day of days) {
    const dow = getDay(day); // 0=Sun
    const dom = day.getDate();
    let match = false;
    if (schedule.type === 'daily') {
      match = true;
    } else if (schedule.type === 'weekly' && schedule.daysOfWeek) {
      // Convert JS getDay (0=Sun) to our format (1=Mon..7=Sun)
      const converted = dow === 0 ? 7 : dow;
      match = schedule.daysOfWeek.includes(converted);
    } else if (schedule.type === 'monthly' && schedule.dayOfMonth) {
      match = dom === schedule.dayOfMonth;
    }
    if (match) {
      set.add(format(day, 'yyyy-MM-dd'));
    }
  }
  return set;
};

const statusIcon = (status: string) => {
  switch (status) {
    case 'success':
      return <PiCheckCircle className="text-green-500" />;
    case 'error':
      return <PiXCircle className="text-red-500" />;
    case 'running':
      return <PiSpinnerGap className="animate-spin text-blue-500" />;
    default:
      return <PiCircle className="text-gray-300" />;
  }
};

const statusBg = (status: string) => {
  switch (status) {
    case 'success':
      return 'bg-green-50 border-green-200';
    case 'error':
      return 'bg-red-50 border-red-200';
    case 'running':
      return 'bg-blue-50 border-blue-200';
    default:
      return 'bg-gray-50 border-gray-200';
  }
};

const SchedulerPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());

  const api = useSchedulerApi();
  const { data: tasksData } = api.listTasks();

  // Compute date range for the view
  const { visibleDays, queryStartDate, queryEndDate } = useMemo(() => {
    let start: Date;
    let end: Date;
    if (viewMode === 'month') {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      start = startOfWeek(monthStart, { weekStartsOn: 1 });
      end = endOfWeek(monthEnd, { weekStartsOn: 1 });
    } else {
      start = startOfWeek(currentDate, { weekStartsOn: 1 });
      end = endOfWeek(currentDate, { weekStartsOn: 1 });
    }
    return {
      visibleDays: eachDayOfInterval({ start, end }),
      queryStartDate: format(start, 'yyyy-MM-dd'),
      queryEndDate: format(end, 'yyyy-MM-dd'),
    };
  }, [currentDate, viewMode]);

  const { data: executionsData } = api.listExecutionsByUser(
    queryStartDate,
    queryEndDate
  );

  const tasks = useMemo(() => tasksData?.tasks ?? [], [tasksData]);
  const executions = useMemo(
    () => executionsData?.executions ?? [],
    [executionsData]
  );

  // Index executions by date
  const executionsByDate = useMemo(() => {
    const map = new Map<string, TaskExecutionSummary[]>();
    for (const exec of executions) {
      const dateKey = format(parseISO(exec.startedAt), 'yyyy-MM-dd');
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(exec);
    }
    return map;
  }, [executions]);

  // Index tasks by id
  const tasksById = useMemo(() => {
    const map = new Map<string, ScheduledTaskResponse>();
    for (const t of tasks) map.set(t.taskId, t);
    return map;
  }, [tasks]);

  // For each task, compute scheduled days
  const taskScheduledDays = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const task of tasks) {
      map.set(task.taskId, getScheduledDays(task, visibleDays));
    }
    return map;
  }, [tasks, visibleDays]);

  const navigatePrev = useCallback(() => {
    setCurrentDate((d) =>
      viewMode === 'month' ? subMonths(d, 1) : subWeeks(d, 1)
    );
  }, [viewMode]);

  const navigateNext = useCallback(() => {
    setCurrentDate((d) =>
      viewMode === 'month' ? addMonths(d, 1) : addWeeks(d, 1)
    );
  }, [viewMode]);

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const weekDayLabels = [
    t('scheduler.day_monday'),
    t('scheduler.day_tuesday'),
    t('scheduler.day_wednesday'),
    t('scheduler.day_thursday'),
    t('scheduler.day_friday'),
    t('scheduler.day_saturday'),
    t('scheduler.day_sunday'),
  ];

  // Build cell data for a given day
  const getCellItems = useCallback(
    (day: Date) => {
      const dateKey = format(day, 'yyyy-MM-dd');
      const dayExecutions = executionsByDate.get(dateKey) ?? [];

      // Tasks that had executions this day
      const executedTaskIds = new Set(dayExecutions.map((e) => e.taskId));

      // Build items: for executed tasks, show with status; for scheduled-only, show as pending
      const items: {
        taskId: string;
        taskName: string;
        status: string;
        executionId?: string;
      }[] = [];

      // Add executed tasks
      for (const exec of dayExecutions) {
        const task = tasksById.get(exec.taskId);
        items.push({
          taskId: exec.taskId,
          taskName: task?.taskName ?? t('scheduler.unknown_task'),
          status: exec.status,
          executionId: exec.executionId,
        });
      }

      // Add scheduled (not yet executed) tasks for today or future
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dayNorm = new Date(day);
      dayNorm.setHours(0, 0, 0, 0);

      if (dayNorm >= today) {
        for (const task of tasks) {
          if (executedTaskIds.has(task.taskId)) continue;
          const scheduled = taskScheduledDays.get(task.taskId);
          if (scheduled?.has(dateKey)) {
            items.push({
              taskId: task.taskId,
              taskName: task.taskName,
              status: 'scheduled',
            });
          }
        }
      }

      return items;
    },
    [executionsByDate, tasksById, tasks, taskScheduledDays, t]
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <PiCalendarBlank className="text-2xl" />
          <h1 className="text-xl font-semibold">{t('scheduler.title')}</h1>
        </div>
        <Button onClick={() => navigate('/scheduler/new')}>
          <PiPlus className="mr-1" />
          {t('scheduler.new_task')}
        </Button>
      </div>

      {/* Navigation */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ButtonIcon onClick={navigatePrev}>
            <PiCaretLeft />
          </ButtonIcon>
          <ButtonIcon onClick={navigateNext}>
            <PiCaretRight />
          </ButtonIcon>
          <button
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
            onClick={goToToday}>
            {t('scheduler.today')}
          </button>
          <span className="ml-2 text-lg font-medium">
            {viewMode === 'month'
              ? format(currentDate, 'yyyy MMMM', {
                  locale: i18n.language === 'ja' ? ja : enUS,
                })
              : `${format(visibleDays[0], 'M/d')} - ${format(visibleDays[visibleDays.length - 1], 'M/d')}`}
          </span>
        </div>
        <div className="flex rounded border border-gray-300">
          <button
            className={`px-3 py-1 text-sm ${viewMode === 'month' ? 'bg-aws-squid-ink text-white' : 'hover:bg-gray-50'}`}
            onClick={() => setViewMode('month')}>
            {t('scheduler.month_view')}
          </button>
          <button
            className={`border-l border-gray-300 px-3 py-1 text-sm ${viewMode === 'week' ? 'bg-aws-squid-ink text-white' : 'hover:bg-gray-50'}`}
            onClick={() => setViewMode('week')}>
            {t('scheduler.week_view')}
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {weekDayLabels.map((label, i) => (
            <div
              key={i}
              className={`py-2 text-center text-xs font-medium ${
                i >= 5 ? 'text-gray-400' : 'text-gray-600'
              }`}>
              {label}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {visibleDays.map((day, idx) => {
            const items = getCellItems(day);
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isWeekend = getDay(day) === 0 || getDay(day) === 6;

            return (
              <div
                key={idx}
                className={`min-h-[100px] border-b border-r border-gray-100 p-1 ${
                  viewMode === 'week' ? 'min-h-[200px]' : ''
                } ${!isCurrentMonth && viewMode === 'month' ? 'bg-gray-50/50' : ''} ${
                  isWeekend ? 'bg-gray-50/30' : ''
                }`}>
                {/* Date number */}
                <div className="mb-1 flex justify-end">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      isToday(day)
                        ? 'bg-aws-smile font-bold text-white'
                        : !isCurrentMonth && viewMode === 'month'
                          ? 'text-gray-300'
                          : 'text-gray-700'
                    }`}>
                    {format(day, 'd')}
                  </span>
                </div>

                {/* Task items */}
                <div className="flex flex-col gap-0.5">
                  {items
                    .slice(0, viewMode === 'week' ? 10 : 3)
                    .map((item, i) => (
                      <button
                        key={i}
                        className={`flex w-full items-center gap-1 truncate rounded border px-1 py-0.5 text-left text-[10px] leading-tight transition-colors hover:brightness-95 ${statusBg(item.status)}`}
                        onClick={() => {
                          if (item.executionId) {
                            navigate(
                              `/scheduler/${item.taskId}/executions/${encodeURIComponent(item.executionId)}`
                            );
                          } else {
                            navigate(`/scheduler/${item.taskId}`);
                          }
                        }}>
                        {statusIcon(item.status)}
                        <span className="truncate">{item.taskName}</span>
                      </button>
                    ))}
                  {items.length > (viewMode === 'week' ? 10 : 3) && (
                    <span className="text-[10px] text-gray-400">
                      {t('scheduler.more_items', {
                        count: items.length - (viewMode === 'week' ? 10 : 3),
                      })}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Task List (below calendar) */}
      {tasks.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-600">
            {t('scheduler.registered_tasks', { count: tasks.length })}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tasks.map((task) => (
              <button
                key={task.taskId}
                className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-left transition-colors hover:bg-gray-50"
                onClick={() => navigate(`/scheduler/${task.taskId}`)}>
                <div
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    task.enabled ? 'bg-green-400' : 'bg-gray-300'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {task.taskName}
                  </div>
                  <div className="text-xs text-gray-400">
                    {formatScheduleLabel(task.schedule, t)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {tasks.length === 0 && tasksData && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <PiCalendarBlank className="mb-4 h-12 w-12" />
          <p className="mb-2 text-sm font-bold">
            {t('scheduler.empty_no_tasks')}
          </p>
          <p className="mb-4 text-xs">{t('scheduler.empty_suggestion')}</p>
          <Button onClick={() => navigate('/scheduler/new')}>
            <PiPlus className="mr-1" />
            {t('scheduler.new_task_create')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default SchedulerPage;
