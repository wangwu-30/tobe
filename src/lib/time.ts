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

function toDate(value: DateInput) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
