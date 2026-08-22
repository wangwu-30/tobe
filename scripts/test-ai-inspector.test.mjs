import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { aiInspectorScenarios } from './test-ai-inspector.mjs';

const expectedScenarios = [
  ['A1', 'AI inspector A1 first-use flow passes the blackbox gate'],
  ['A2', 'AI inspector A2 web first-use flow auto-starts preview'],
  ['A3', 'AI inspector A3 ambiguous first-use flow surfaces intent clarify cards'],
  ['B2', 'AI inspector B2 chat advance flow writes directly into the live draft'],
  ['B3', 'AI inspector B3 version save flow reaches history and compare cleanly'],
  ['B4', 'AI inspector B4 branch continue and switch flow keeps the current branch clear'],
  ['C1', 'AI inspector C1 context knowledge flow creates, edits, and persists a note'],
  ['C2', 'AI inspector C2 context workflow flow applies a builtin workflow to the current task'],
];

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.resolve(
  scriptRoot,
  '../tests/blackbox/chengxing/ai-inspector.spec.ts'
);

test('AI inspector enumerates every implemented scenario with its exact test title', async () => {
  assert.deepEqual(
    aiInspectorScenarios.map(({ id, title }) => [id, title]),
    expectedScenarios
  );
  assert.equal(new Set(aiInspectorScenarios.map(({ id }) => id)).size, 8);

  const specSource = await fs.readFile(specPath, 'utf8');
  const implementedTitles = [
    ...specSource.matchAll(/^test\('([^']+)'/gmu),
  ].map((match) => match[1]);
  assert.deepEqual(
    aiInspectorScenarios.map(({ title }) => title),
    implementedTitles,
    'The runner must enumerate every implemented AI inspector test exactly once.'
  );
});
