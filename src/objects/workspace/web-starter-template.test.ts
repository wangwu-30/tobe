import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCompanionWebWorkspaceTitle,
  buildWorkspaceFileSeeds,
  deriveWorkspaceTitle,
  mergeIntentDetailIntoConstraints,
  slugProjectTitle,
} from './web-starter-template';

test('buildWorkspaceFileSeeds generates escaped offline HTML + CSS for web deliverables', () => {
  const seeds = buildWorkspaceFileSeeds({
    deliverableType: 'web',
    heading: 'Launch <Alpha> & "Beta"',
  });

  assert.equal(seeds.primary.name, 'index.html');
  assert.equal(seeds.primary.kind, 'code');
  assert.match(seeds.primary.content, /<title>Launch &lt;Alpha&gt; &amp; &quot;Beta&quot;<\/title>/);
  assert.equal(seeds.additional.length, 1);
  assert.equal(seeds.additional[0]?.name, 'styles.css');
});

test('buildWorkspaceFileSeeds defaults document deliverables to richtext main file', () => {
  const seeds = buildWorkspaceFileSeeds({
    deliverableType: 'document',
    heading: 'Architecture Memo',
    initialContent: '[{"type":"p","children":[{"text":"Hello"}]}]',
  });

  assert.equal(seeds.primary.name, 'main');
  assert.equal(seeds.primary.kind, 'richtext');
  assert.equal(seeds.primary.content, '[{"type":"p","children":[{"text":"Hello"}]}]');
  assert.deepEqual(seeds.additional, []);
});

test('deriveWorkspaceTitle strips leading Chinese creation verbs and trims long clauses', () => {
  assert.equal(deriveWorkspaceTitle('写一份产品发布计划，覆盖 Q3 目标。'), '产品发布计划');
  assert.equal(deriveWorkspaceTitle('   '), null);
  assert.equal(
    deriveWorkspaceTitle('ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'),
    'ABCDEFGHIJKLMNOPQRSTUVWXY…'
  );
});

test('slugProjectTitle, mergeIntentDetailIntoConstraints, and buildCompanionWebWorkspaceTitle format deterministically', () => {
  assert.equal(slugProjectTitle('  Launch / Plan: v2!  '), 'Launch-Plan-v2');
  assert.equal(slugProjectTitle('!!!'), 'project');
  assert.equal(
    mergeIntentDetailIntoConstraints('Keep concise', 'Interactive landing page'),
    'Keep concise\n\nSupplementary result-shape note: Interactive landing page'
  );
  assert.equal(mergeIntentDetailIntoConstraints('Keep concise', null), 'Keep concise');
  assert.equal(buildCompanionWebWorkspaceTitle('Roadmap', 'zh-CN'), 'Roadmap 配套网页');
  assert.equal(buildCompanionWebWorkspaceTitle('Roadmap', 'en-US'), 'Roadmap Companion Site');
});
