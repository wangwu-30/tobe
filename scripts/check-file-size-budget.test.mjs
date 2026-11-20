import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkFileSizeBudget,
  countSourceLines,
  evaluateFileSizeBudget,
  validateBudgetConfig,
} from './check-file-size-budget.mjs';

const baseConfig = {
  apiRouteMaxLines: 400,
  defaultMaxLines: 1200,
  exemptDataFiles: {
    'src/lib/i18n/copy.ts': 'Copy table',
  },
  legacyAllowlist: {
    'src/app/api/legacy/route.ts': 450,
    'src/components/legacy-panel.tsx': 1600,
  },
  ratchetSlackLines: 50,
};

test('countSourceLines matches POSIX line count across LF, CRLF, and trailing newlines', () => {
  assert.equal(countSourceLines(''), 0);
  assert.equal(countSourceLines('one'), 1);
  assert.equal(countSourceLines('one\n'), 1);
  assert.equal(countSourceLines('one\ntwo\n'), 2);
  assert.equal(countSourceLines('one\r\ntwo\r\nthree'), 3);
});

test('evaluateFileSizeBudget passes when every file honors default, API route, and legacy ratchet limits', () => {
  const violations = evaluateFileSizeBudget(
    {
      'src/app/api/legacy/route.ts': 440,
      'src/app/api/ok/route.ts': 390,
      'src/components/legacy-panel.tsx': 1590,
      'src/components/new-panel.tsx': 900,
      'src/lib/i18n/copy.ts': 4000,
    },
    baseConfig
  );
  assert.deepEqual(violations, []);
});

test('evaluateFileSizeBudget rejects new oversize production files and oversize API routes', () => {
  const violations = evaluateFileSizeBudget(
    {
      'src/app/api/bloated/route.ts': 401,
      'src/app/api/legacy/route.ts': 450,
      'src/components/bloated.tsx': 1201,
      'src/components/legacy-panel.tsx': 1600,
      'src/lib/i18n/copy.ts': 3000,
    },
    baseConfig
  );

  assert.deepEqual(
    violations.map(({ file, rule }) => ({ file, rule })),
    [
      { file: 'src/app/api/bloated/route.ts', rule: 'exceeds-api-route-budget' },
      { file: 'src/components/bloated.tsx', rule: 'exceeds-default-budget' },
    ]
  );
});

test('evaluateFileSizeBudget rejects growth in legacy allowlisted files', () => {
  const violations = evaluateFileSizeBudget(
    {
      'src/app/api/legacy/route.ts': 451,
      'src/components/legacy-panel.tsx': 1601,
      'src/lib/i18n/copy.ts': 3000,
    },
    baseConfig
  );

  assert.deepEqual(
    violations.map(({ file, rule }) => ({ file, rule })),
    [
      { file: 'src/app/api/legacy/route.ts', rule: 'exceeds-legacy-budget' },
      { file: 'src/components/legacy-panel.tsx', rule: 'exceeds-legacy-budget' },
    ]
  );
});

test('evaluateFileSizeBudget forces removal when an allowlisted file drops under default ceiling and tightening on >= slack shrinkage', () => {
  const violations = evaluateFileSizeBudget(
    {
      'src/app/api/legacy/route.ts': 380,
      'src/components/legacy-panel.tsx': 1500,
      'src/lib/i18n/copy.ts': 3000,
    },
    baseConfig
  );

  assert.deepEqual(
    violations.map(({ file, rule }) => ({ file, rule })),
    [
      {
        file: 'src/app/api/legacy/route.ts',
        rule: 'allowlist-entry-under-ceiling',
      },
      {
        file: 'src/components/legacy-panel.tsx',
        rule: 'allowlist-ratchet-needs-tightening',
      },
    ]
  );
});

test('evaluateFileSizeBudget rejects stale allowlist and exempt entries', () => {
  const violations = evaluateFileSizeBudget({}, baseConfig);
  assert.deepEqual(
    violations.map(({ file, rule }) => ({ file, rule })),
    [
      { file: 'src/app/api/legacy/route.ts', rule: 'stale-allowlist-entry' },
      { file: 'src/components/legacy-panel.tsx', rule: 'stale-allowlist-entry' },
      { file: 'src/lib/i18n/copy.ts', rule: 'stale-exempt-entry' },
    ]
  );
});

test('validateBudgetConfig fails closed on invalid limits or overlapping entries', () => {
  assert.throws(
    () =>
      validateBudgetConfig({
        ...baseConfig,
        legacyAllowlist: {
          'src/lib/i18n/copy.ts': 4000,
        },
      }),
    /cannot appear in both exemptDataFiles and legacyAllowlist/u
  );
  assert.throws(
    () =>
      validateBudgetConfig({
        ...baseConfig,
        legacyAllowlist: {
          'src/components/too-small.tsx': 1200,
        },
      }),
    /must be an integer greater than default ceiling/u
  );
});

test('repository file-size budget currently passes with zero violations', async () => {
  const result = await checkFileSizeBudget();
  assert.equal(result.violations.length, 0);
  assert.ok(result.fileCount > 100);
});
