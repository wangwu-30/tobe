import { createHash } from 'node:crypto';

import { ValidationError } from '@/framework/resilience/app-error';

/**
 * Canonical JSON for tool parameters. Object keys are sorted recursively while
 * array order is retained. Values that JSON would silently drop or coerce are
 * rejected so an approval can never cover a different effective payload.
 */
export function canonicalizeRoomToolParameters(value: unknown): string {
  try {
    return serializeCanonicalJson(value, new Set<object>());
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Tool parameters must be canonical JSON.', {
      cause: error,
    });
  }
}

export function hashRoomToolParameters(value: unknown): string {
  return createHash('sha256')
    .update(canonicalizeRoomToolParameters(value))
    .digest('hex');
}

function serializeCanonicalJson(
  value: unknown,
  ancestors: Set<object>
): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new ValidationError(
          'Tool parameters cannot contain non-finite numbers.'
        );
      }
      // JSON stringification canonicalizes -0 to 0 and uses a deterministic
      // ECMAScript number representation.
      return JSON.stringify(value);
    }
    case 'string':
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new ValidationError(
        'Tool parameters must contain only JSON-compatible values.'
      );
  }

  if (ancestors.has(value)) {
    throw new ValidationError('Tool parameters cannot contain cycles.');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      assertPlainArray(value);
      return `[${value
        .map((entry) => serializeCanonicalJson(entry, ancestors))
        .join(',')}]`;
    }

    assertPlainRecord(value);
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serializeCanonicalJson(
            value[key],
            ancestors
          )}`
      )
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function assertPlainArray(value: unknown[]) {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new ValidationError('Tool parameter arrays cannot have symbol keys.');
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new ValidationError('Tool parameter arrays cannot be sparse.');
    }
  }
  const unexpectedKey = Object.keys(value).find(
    (key) => !isCanonicalArrayIndex(key, value.length)
  );
  if (unexpectedKey) {
    throw new ValidationError(
      'Tool parameter arrays cannot have named properties.'
    );
  }
}

function assertPlainRecord(
  value: object
): asserts value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ValidationError('Tool parameter objects must be plain objects.');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new ValidationError('Tool parameter objects cannot have symbol keys.');
  }
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value)
  )) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new ValidationError(
        'Tool parameter objects must contain enumerable data properties only.'
      );
    }
  }
}

function isCanonicalArrayIndex(key: string, length: number) {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}
