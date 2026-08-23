const DEFAULT_SQLITE_BUSY_RETRY_DELAYS_MS = [10, 25, 50, 100, 200] as const;
const SQLITE_BUSY_PRIMARY_CODE = 5;
const SQLITE_BUSY_PRIMARY_CODE_MASK = 0xff;

export type SqliteBusyRetryOptionsV1 = {
  delaysMs?: readonly number[];
  wait?: (durationMs: number) => Promise<void>;
};

/**
 * Retries one complete durable command after local SQLite lock contention.
 * Callers must pass the same immutable command input on every invocation; a
 * lease conflict or any other database failure is deliberately never retried.
 */
export async function retrySqliteBusyV1<T>(
  operation: () => Promise<T>,
  options: SqliteBusyRetryOptionsV1 = {}
): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_SQLITE_BUSY_RETRY_DELAYS_MS;
  const wait = options.wait ?? waitForRetry;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSqliteBusyErrorV1(error) || attempt >= delays.length) {
        throw error;
      }
      const delay = delays[attempt];
      if (!Number.isSafeInteger(delay) || delay < 0) {
        throw new Error('SQLite busy retry delays must be non-negative integers.');
      }
      await wait(delay);
    }
  }
}

/** Covers direct libSQL errors and Prisma's P1008 driver-adapter wrapper. */
export function isSqliteBusyErrorV1(error: unknown): boolean {
  const seen = new Set<object>();
  const pending: unknown[] = [error];
  let inspected = 0;

  while (pending.length > 0 && inspected < 32) {
    const value = pending.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    inspected += 1;
    const record = value as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message : '';
    const code = record.code;
    const rawCode = numericSqliteCode(record.rawCode);
    const originalCode = numericSqliteCode(record.originalCode);

    if (
      code === 'SQLITE_BUSY' ||
      rawCode === SQLITE_BUSY_PRIMARY_CODE ||
      originalCode === SQLITE_BUSY_PRIMARY_CODE ||
      message.includes('SQLITE_BUSY') ||
      /database (?:is )?locked/i.test(message)
    ) {
      return true;
    }

    // Prisma maps SQLite primary code 5 to P1008/SocketTimeout. Require the
    // nested driver code/message above; an unrelated remote timeout is not a
    // local lock and must propagate.
    for (const key of ['cause', 'meta', 'driverAdapterError'] as const) {
      if (record[key] && typeof record[key] === 'object') {
        pending.push(record[key]);
      }
    }
  }
  return false;
}

function numericSqliteCode(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(numeric) &&
    (numeric & SQLITE_BUSY_PRIMARY_CODE_MASK) === SQLITE_BUSY_PRIMARY_CODE
    ? SQLITE_BUSY_PRIMARY_CODE
    : null;
}

function waitForRetry(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
