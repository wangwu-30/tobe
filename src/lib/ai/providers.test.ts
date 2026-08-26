import { expect, test } from '@playwright/test';

import { parseModelKey } from './model-selection';

test('uses the current default only when the model selection is empty', () => {
  expect(parseModelKey('')).toEqual({
    key: 'openai-codex::gpt-5.4',
    modelId: 'gpt-5.4',
    providerId: 'openai-codex',
  });
});

test('migrates only the known legacy default model', () => {
  expect(parseModelKey('openai-codex::gpt-5.2-codex')).toEqual({
    key: 'openai-codex::gpt-5.4',
    modelId: 'gpt-5.4',
    providerId: 'openai-codex',
  });
});

test('rejects an unrecognized non-empty bare model instead of crossing providers', () => {
  expect(() => parseModelKey('bogus-model')).toThrow(
    'Unrecognized model selection: bogus-model'
  );
});
