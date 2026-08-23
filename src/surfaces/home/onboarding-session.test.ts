import { expect, test } from '@playwright/test';

import {
  HOME_ONBOARDING_CONVERSATION_PARAM,
  HOME_ONBOARDING_CONVERSATION_STORAGE_KEY,
  findLastUserGoal,
  normalizeOnboardingConversationId,
} from './onboarding-session';

test('uses stable recovery keys for the home onboarding conversation', () => {
  expect(HOME_ONBOARDING_CONVERSATION_PARAM).toBe('onboardingConversationId');
  expect(HOME_ONBOARDING_CONVERSATION_STORAGE_KEY).toBe(
    'dao-home-onboarding-conversation-id'
  );
});

test('normalizes restorable onboarding conversation identifiers', () => {
  expect(normalizeOnboardingConversationId('  conversation-1  ')).toBe(
    'conversation-1'
  );
  expect(normalizeOnboardingConversationId('   ')).toBeNull();
  expect(normalizeOnboardingConversationId(null)).toBeNull();
});

test('uses the latest non-empty user message as the Wiki goal', () => {
  expect(
    findLastUserGoal([
      { content: 'first goal', role: 'user' },
      { content: 'a follow-up', role: 'assistant' },
      { content: '  refined Wiki goal  ', role: 'user' },
      { content: '   ', role: 'user' },
    ])
  ).toBe('refined Wiki goal');
  expect(findLastUserGoal([{ content: 'assistant only', role: 'assistant' }])).toBe(
    ''
  );
});
