import assert from 'node:assert/strict';

/**
 * Recursively verifies that `actual` contains every key/value specified in
 * `expected` (matching Jest/Playwright `toMatchObject` semantics) while staying
 * 100% compatible with Node 22+ `node:assert/strict` and `@types/node@22`.
 */
export function assertMatchesObject(
  actual: unknown,
  expected: unknown,
  path = '$'
): void {
  if (
    expected === null ||
    typeof expected !== 'object' ||
    expected instanceof Date ||
    expected instanceof RegExp
  ) {
    assert.deepEqual(actual, expected, `Mismatch at ${path}`);
    return;
  }

  if (Array.isArray(expected)) {
    assert.ok(
      Array.isArray(actual),
      `Expected array at ${path}, received ${typeof actual}`
    );
    assert.equal(
      actual.length,
      expected.length,
      `Expected array length ${expected.length} at ${path}, received ${actual.length}`
    );
    for (let index = 0; index < expected.length; index += 1) {
      assertMatchesObject(actual[index], expected[index], `${path}[${index}]`);
    }
    return;
  }

  assert.ok(
    actual !== null && typeof actual === 'object' && !Array.isArray(actual),
    `Expected object at ${path}, received ${actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual}`
  );

  const actualRecord = actual as Record<string, unknown>;
  for (const [key, expectedValue] of Object.entries(
    expected as Record<string, unknown>
  )) {
    if (expectedValue === undefined) {
      assert.equal(
        actualRecord[key],
        undefined,
        `Expected ${path}.${key} to be undefined`
      );
      continue;
    }
    assert.ok(
      key in actualRecord,
      `Expected property ${path}.${key} to exist`
    );
    assertMatchesObject(actualRecord[key], expectedValue, `${path}.${key}`);
  }
}

/**
 * Verifies that `items` includes at least one entry matching `expected`.
 */
export function assertContainsMatch(
  items: readonly unknown[],
  expected: unknown,
  message?: string
): void {
  for (const item of items) {
    try {
      assertMatchesObject(item, expected);
      return;
    } catch {
      // Keep checking remaining items.
    }
  }
  assert.fail(
    message ??
      `Expected array to contain an item matching ${JSON.stringify(expected)}`
  );
}

/**
 * Predicate helper for `assert.rejects(fn, (err) => assertErrorMatches(...))`
 * and `assert.throws(fn, (err) => assertErrorMatches(...))`.
 */
export function assertErrorMatches<T extends Error>(
  error: unknown,
  expected: Record<string, unknown>,
  ErrorClass?: abstract new (...args: never[]) => T
): true {
  if (ErrorClass) {
    assert.ok(
      error instanceof ErrorClass,
      `Expected error to be instance of ${ErrorClass.name}`
    );
  } else {
    assert.ok(error instanceof Error, 'Expected thrown value to be an Error');
  }
  assertMatchesObject(error, expected, '$error');
  return true;
}
