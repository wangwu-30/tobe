import { createHash } from 'node:crypto';

type CanonicalJson =
  | boolean
  | number
  | string
  | null
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

export class RoomContextHashErrorV1 extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomContextHashErrorV1';
  }
}
function canonicalize(
  value: unknown,
  ancestors: ReadonlySet<object>
): CanonicalJson | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RoomContextHashErrorV1(
        'Room context hashes require finite numbers.'
      );
    }
    return value;
  }

  if (typeof value !== 'object') {
    throw new RoomContextHashErrorV1(
      `Room context hashes do not support ${typeof value} values.`
    );
  }

  if (ancestors.has(value)) {
    throw new RoomContextHashErrorV1(
      'Room context hashes do not support cyclic values.'
    );
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry, nextAncestors) ?? null);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RoomContextHashErrorV1(
      'Room context hashes support only arrays and plain objects.'
    );
  }

  const result: { [key: string]: CanonicalJson } = {};
  for (const key of Object.keys(value).sort()) {
    const entry = canonicalize(
      (value as Record<string, unknown>)[key],
      nextAncestors
    );
    if (entry !== undefined) {
      result[key] = entry;
    }
  }
  return result;
}

export function stableRoomContextJsonV1(value: unknown): string {
  const canonical = canonicalize(value, new Set());
  if (canonical === undefined) {
    throw new RoomContextHashErrorV1(
      'A top-level undefined value cannot be hashed.'
    );
  }
  return JSON.stringify(canonical);
}

export function sha256RoomContextV1(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashRoomContextValueV1(value: unknown): string {
  return sha256RoomContextV1(stableRoomContextJsonV1(value));
}
