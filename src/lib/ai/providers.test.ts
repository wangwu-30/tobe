import assert from 'node:assert/strict';
import test from 'node:test';

import { parseModelKey } from './model-selection';

test('uses the current default only when the model selection is empty', () => {
  assert.deepEqual(parseModelKey(''), {
    key: 'openai-codex::gpt-5.4',
    modelId: 'gpt-5.4',
    providerId: 'openai-codex',
  });
});

test('migrates only the known legacy default model', () => {
  assert.deepEqual(parseModelKey('openai-codex::gpt-5.2-codex'), {
    key: 'openai-codex::gpt-5.4',
    modelId: 'gpt-5.4',
    providerId: 'openai-codex',
  });
});

test('rejects an unrecognized non-empty bare model instead of crossing providers', () => {
  assert.throws(
    () => parseModelKey('bogus-model'),
    /Unrecognized model selection: bogus-model/
  );
});
