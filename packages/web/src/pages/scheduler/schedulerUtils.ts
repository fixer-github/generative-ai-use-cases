// Helper to display schedule in human-readable form
export const formatScheduleLabel = (
  schedule: {
    type: string;
    time: string;
    daysOfWeek?: number[];
    dayOfMonth?: number;
  },
  t: (key: string, options?: Record<string, unknown>) => string
): string => {
  const dayNames = [
    '',
    t('scheduler.day_monday'),
    t('scheduler.day_tuesday'),
    t('scheduler.day_wednesday'),
    t('scheduler.day_thursday'),
    t('scheduler.day_friday'),
    t('scheduler.day_saturday'),
    t('scheduler.day_sunday'),
  ];
  const time = schedule.time;

  switch (schedule.type) {
    case 'daily':
      return t('scheduler.schedule_daily', { time });
    case 'weekly': {
      const days = (schedule.daysOfWeek ?? [])
        .map((d) => dayNames[d])
        .join(', ');
      return t('scheduler.schedule_weekly', { days, time });
    }
    case 'monthly':
      return t('scheduler.schedule_monthly', {
        day: schedule.dayOfMonth,
        time,
      });
    default:
      return time;
  }
};
