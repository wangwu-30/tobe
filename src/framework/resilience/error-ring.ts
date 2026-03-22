import { isRecord, safeArray, safeGet, safeJsonParse } from './safe-data';

const ERROR_RING_STORAGE_KEY = 'dao-error-ring';
const ERROR_RING_MAX_ITEMS = 50;

export type ErrorRingEntry = {
  detail: string | null;
  message: string;
  source: 'boundary' | 'global';
  stack: string | null;
  timestamp: number;
  zone: string | null;
};

export function readErrorRing(): ErrorRingEntry[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(ERROR_RING_STORAGE_KEY);
  return safeJsonParse<ErrorRingEntry[]>(raw, [], isErrorRingEntryList);
}

export function recordError(entry: Omit<ErrorRingEntry, 'timestamp'>) {
  if (typeof window === 'undefined') {
    return null;
  }

  const nextEntry: ErrorRingEntry = {
    ...entry,
    timestamp: Date.now(),
  };
  const nextRing = [nextEntry, ...readErrorRing()].slice(0, ERROR_RING_MAX_ITEMS);
  window.localStorage.setItem(ERROR_RING_STORAGE_KEY, JSON.stringify(nextRing));
  return nextEntry;
}

function isErrorRingEntryList(value: unknown): value is ErrorRingEntry[] {
  return safeArray(value, isErrorRingEntry).length === (Array.isArray(value) ? value.length : 0);
}

function isErrorRingEntry(value: unknown): value is ErrorRingEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof safeGet(value, 'message', null) === 'string' &&
    typeof safeGet(value, 'source', null) === 'string' &&
    typeof safeGet(value, 'timestamp', null) === 'number'
  );
}
