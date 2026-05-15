/**
 * Schedule Configuration to Cron Expression Conversion
 *
 * Converts user-friendly ScheduleConfig to EventBridge Scheduler cron expressions.
 * Timezone is handled by EventBridge Scheduler's ScheduleExpressionTimezone parameter (Asia/Tokyo).
 *
 * EventBridge cron format: cron(minutes hours day-of-month month day-of-week year)
 */

import { ScheduleConfig } from '../types';

/**
 * Convert ScheduleConfig to EventBridge Scheduler cron expression
 */
export function toCronExpression(config: ScheduleConfig): string {
  const [hourStr, minuteStr] = config.time.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  switch (config.type) {
    case 'daily':
      // Every day at specified time
      return `cron(${minute} ${hour} * * ? *)`;

    case 'weekly': {
      if (!config.daysOfWeek || config.daysOfWeek.length === 0) {
        throw new Error('daysOfWeek is required for weekly schedule');
      }
      // Convert ISO weekday (1=Mon...7=Sun) to EventBridge (SUN=1...SAT=7 or SUN-SAT names)
      const dayNames = config.daysOfWeek
        .map((isoDay) => isoWeekdayToEventBridge(isoDay))
        .join(',');
      return `cron(${minute} ${hour} ? * ${dayNames} *)`;
    }

    case 'monthly': {
      if (
        !config.dayOfMonth ||
        config.dayOfMonth < 1 ||
        config.dayOfMonth > 28
      ) {
        throw new Error(
          'dayOfMonth must be between 1 and 28 for monthly schedule'
        );
      }
      return `cron(${minute} ${hour} ${config.dayOfMonth} * ? *)`;
    }

    default:
      throw new Error(`Unsupported schedule type: ${config.type}`);
  }
}

/**
 * Convert ISO 8601 weekday number to EventBridge day-of-week name
 * ISO: 1=Monday, 2=Tuesday, ..., 7=Sunday
 * EventBridge: SUN, MON, TUE, WED, THU, FRI, SAT
 */
function isoWeekdayToEventBridge(isoDay: number): string {
  const mapping: Record<number, string> = {
    1: 'MON',
    2: 'TUE',
    3: 'WED',
    4: 'THU',
    5: 'FRI',
    6: 'SAT',
    7: 'SUN',
  };
  const name = mapping[isoDay];
  if (!name) {
    throw new Error(`Invalid ISO weekday number: ${isoDay}. Must be 1-7.`);
  }
  return name;
}

/**
 * Validate ScheduleConfig
 */
export function validateScheduleConfig(config: ScheduleConfig): string | null {
  if (!config.type || !['daily', 'weekly', 'monthly'].includes(config.type)) {
    return 'schedule.type must be "daily", "weekly", or "monthly"';
  }

  if (!config.time || !/^\d{2}:\d{2}$/.test(config.time)) {
    return 'schedule.time must be in "HH:mm" format';
  }

  const [hourStr, minuteStr] = config.time.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return 'schedule.time has invalid hour or minute values';
  }

  if (config.type === 'weekly') {
    if (!config.daysOfWeek || config.daysOfWeek.length === 0) {
      return 'schedule.daysOfWeek is required for weekly schedule';
    }
    for (const day of config.daysOfWeek) {
      if (!Number.isInteger(day) || day < 1 || day > 7) {
        return 'schedule.daysOfWeek values must be integers between 1 (Mon) and 7 (Sun)';
      }
    }
  }

  if (config.type === 'monthly') {
    if (
      config.dayOfMonth === undefined ||
      !Number.isInteger(config.dayOfMonth) ||
      config.dayOfMonth < 1 ||
      config.dayOfMonth > 28
    ) {
      return 'schedule.dayOfMonth must be an integer between 1 and 28';
    }
  }

  return null; // Valid
}
