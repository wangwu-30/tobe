import { expect, test } from '@playwright/test';

import {
  deriveOnboardingWikiProposal,
  parseStructuredWikiProposal,
  stripOnboardingProposalBlocks,
  suggestTitleFromGoal,
} from './onboarding-proposal';

test('parses structured wiki-space-proposal fenced JSON and strips it cleanly from prose', () => {
  const reply = [
    '我们可以先把产品定位与决策记录集中到一个 Wiki 空间里。',
    '',
    '```wiki-space-proposal',
    '{"title": "产品决策手册", "purpose": "沉淀核心需求取舍、设计契约与里程碑复盘"}',
    '```',
  ].join('\n');

  expect(parseStructuredWikiProposal(reply)).toEqual({
    purpose: '沉淀核心需求取舍、设计契约与里程碑复盘',
    title: '产品决策手册',
  });
  expect(stripOnboardingProposalBlocks(reply)).toBe(
    '我们可以先把产品定位与决策记录集中到一个 Wiki 空间里。'
  );
});

test('ignores malformed or titleless wiki-space-proposal blocks safely', () => {
  const broken = [
    'Here is an idea.',
    '```wiki-space-proposal',
    '{not valid json}',
    '```',
    '```wiki-space-proposal',
    '{"title": "   ", "purpose": "Empty title"}',
    '```',
  ].join('\n');

  expect(parseStructuredWikiProposal(broken)).toBeNull();
  expect(stripOnboardingProposalBlocks(broken)).toBe(broken);
});

test('derives structured proposal when assistant emits fence and falls back cleanly after a completed turn', () => {
  expect(deriveOnboardingWikiProposal([])).toBeNull();
  expect(
    deriveOnboardingWikiProposal([
      { content: 'Help me plan a product Wiki.', role: 'user' },
    ])
  ).toBeNull();

  expect(
    deriveOnboardingWikiProposal([
      { content: 'Help me plan a durable product decisions Wiki.', role: 'user' },
      { content: 'Let us shape that Wiki together.', role: 'assistant' },
    ])
  ).toEqual({
    purpose: 'Help me plan a durable product decisions Wiki.',
    source: 'conversation-summary',
    title: 'durable product decisions Wiki',
  });

  expect(
    deriveOnboardingWikiProposal([
      { content: '帮我整理一套研发规范和故障复盘知识库。', role: 'user' },
      {
        content: [
          '很清晰的切入点，建议先建下面这个空间：',
          '```wiki-space-proposal',
          '{"title": "研发规范与复盘", "purpose": "沉淀工程规范、架构决策与事故复盘"}',
          '```',
        ].join('\n'),
        role: 'assistant',
      },
    ])
  ).toEqual({
    purpose: '沉淀工程规范、架构决策与事故复盘',
    source: 'assistant-structured',
    title: '研发规范与复盘',
  });
});

test('derives concise Chinese and English titles from user goals', () => {
  expect(suggestTitleFromGoal('帮我整理一个个人阅读与思考知识库。')).toBe(
    '个人阅读与思考知识库'
  );
  expect(
    suggestTitleFromGoal('Please help me create a mobile-friendly product Wiki.')
  ).toBe('mobile-friendly product Wiki');
});
