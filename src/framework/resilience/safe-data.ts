type JsonValidator<T> = (value: unknown) => value is T;

export function safeJsonParse<T>(
  raw: string | null | undefined,
  fallback: T,
  validator?: JsonValidator<T>
) {
  if (typeof raw !== 'string') {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (validator && !validator(parsed)) {
      return fallback;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function safeArray<T>(
  value: unknown,
  predicate?: (entry: unknown) => entry is T
): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  if (!predicate) {
    return value as T[];
  }

  return value.filter(predicate);
}

export function safeGet<T>(
  value: unknown,
  path: Array<number | string> | string,
  fallback: T
) {
  const segments = Array.isArray(path) ? path : path.split('.').filter(Boolean);
  let current: unknown = value;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return fallback;
    }

    if (typeof segment === 'number') {
      if (!Array.isArray(current)) {
        return fallback;
      }
      current = current[segment];
      continue;
    }

    if (typeof current !== 'object' || Array.isArray(current) || !(segment in current)) {
      return fallback;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return (current as T | undefined) ?? fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
