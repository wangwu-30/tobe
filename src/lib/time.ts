import { format } from 'date-fns';

type DateInput = Date | number | string | null | undefined;

export function formatStableDate(value: DateInput, fallback = 'Unknown date') {
  const date = toDate(value);
  return date ? format(date, 'yyyy-MM-dd') : fallback;
}

export function formatStableDateTime(value: DateInput, fallback = 'Unknown time') {
  const date = toDate(value);
  return date ? format(date, 'yyyy-MM-dd HH:mm') : fallback;
}

export function formatLongDate(value: DateInput, fallback = 'Pick a date') {
  const date = toDate(value);
  return date ? format(date, 'MMMM d, yyyy') : fallback;
}

export function formatRelativeTime(
  value: DateInput,
  locale: string,
  fallback = 'Recently'
) {
  const date = toDate(value);
  if (!date) {
    return fallback;
  }

  const diffInSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(diffInSeconds);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (absSeconds < 60) {
    return formatter.format(diffInSeconds, 'second');
  }

  const diffInMinutes = Math.round(diffInSeconds / 60);
  if (Math.abs(diffInMinutes) < 60) {
    return formatter.format(diffInMinutes, 'minute');
  }

  const diffInHours = Math.round(diffInMinutes / 60);
  if (Math.abs(diffInHours) < 24) {
    return formatter.format(diffInHours, 'hour');
  }

  const diffInDays = Math.round(diffInHours / 24);
  if (Math.abs(diffInDays) < 7) {
    return formatter.format(diffInDays, 'day');
  }

  const diffInWeeks = Math.round(diffInDays / 7);
  if (Math.abs(diffInWeeks) < 5) {
    return formatter.format(diffInWeeks, 'week');
  }

  const diffInMonths = Math.round(diffInDays / 30);
  if (Math.abs(diffInMonths) < 12) {
    return formatter.format(diffInMonths, 'month');
  }

  const diffInYears = Math.round(diffInDays / 365);
  return formatter.format(diffInYears, 'year');
}

function toDate(value: DateInput) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
