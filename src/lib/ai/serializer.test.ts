import assert from 'node:assert/strict';
import test from 'node:test';
import type { Value } from 'platejs';

import {
  assertContainsMatch,
  assertMatchesObject,
} from '@/lib/testing/node-assert';

import {
  isSafeLinkUrl,
  markdownToPlate,
  normalizeLinkInputUrl,
  plateToMarkdown,
} from './serializer';

test('markdownToPlate converts headings, lists, code blocks, quotes, and links into Plate 52 nodes', () => {
  const markdown = [
    '# Wiki Guide',
    '',
    'See [Plate Docs](https://platejs.org) with **bold**, *italic*, `code`, and ~~old~~.',
    '',
    '- First bullet',
    '  - Nested bullet',
    '- Second bullet',
    '',
    '1. Step one',
    '2. Step two',
    '',
    '> Important callout',
    '',
    '```ts',
    'const answer = 42;',
    'console.log(answer);',
    '```',
  ].join('\n');

  const value = markdownToPlate(markdown) as Array<Record<string, unknown>>;

  assertMatchesObject(value[0], { type: 'h1' });
  assertMatchesObject(value[1], { type: 'p' });
  const inlineChildren = value[1].children as Array<Record<string, unknown>>;
  assertContainsMatch(inlineChildren, {
    type: 'a',
    url: 'https://platejs.org',
  });
  assertContainsMatch(inlineChildren, { bold: true, text: 'bold' });
  assertContainsMatch(inlineChildren, { italic: true, text: 'italic' });
  assertContainsMatch(inlineChildren, { code: true, text: 'code' });
  assertContainsMatch(inlineChildren, { strikethrough: true, text: 'old' });

  // Unordered list items use Plate 52 indent-based lists
  assertMatchesObject(value[2], {
    type: 'p',
    indent: 1,
    listStyleType: 'disc',
  });
  assertMatchesObject(value[3], {
    type: 'p',
    indent: 2,
    listStyleType: 'disc',
  });
  assertMatchesObject(value[4], {
    type: 'p',
    indent: 1,
    listStyleType: 'disc',
  });

  // Ordered list items preserve sequential listStart
  assertMatchesObject(value[5], {
    type: 'p',
    indent: 1,
    listStart: 1,
    listStyleType: 'decimal',
  });
  assertMatchesObject(value[6], {
    type: 'p',
    indent: 1,
    listStart: 2,
    listStyleType: 'decimal',
  });

  // Blockquote and code block
  assertMatchesObject(value[7], { type: 'blockquote' });
  assertMatchesObject(value[8], {
    type: 'code_block',
    lang: 'typescript',
    children: [
      { type: 'code_line', children: [{ text: 'const answer = 42;' }] },
      { type: 'code_line', children: [{ text: 'console.log(answer);' }] },
    ],
  });

  // Round-trip back to Markdown preserves structure
  const roundTripped = plateToMarkdown(value as Value);
  assert.ok(roundTripped.includes('# Wiki Guide'));
  assert.ok(roundTripped.includes('[Plate Docs](https://platejs.org)'));
  assert.ok(roundTripped.includes('- First bullet'));
  assert.ok(roundTripped.includes('  - Nested bullet'));
  assert.ok(roundTripped.includes('1. Step one'));
  assert.ok(roundTripped.includes('2. Step two'));
  assert.ok(roundTripped.includes('> Important callout'));
  assert.ok(
    roundTripped.includes(
      '```typescript\nconst answer = 42;\nconsole.log(answer);\n```'
    )
  );
});

test('plateToMarkdown preserves legacy ul/ol/li and nested blockquote nodes cleanly', () => {
  const legacyValue = [
    {
      type: 'ul',
      children: [
        { type: 'li', children: [{ type: 'p', children: [{ text: 'Alpha' }] }] },
        { type: 'li', children: [{ type: 'p', children: [{ text: 'Beta' }] }] },
      ],
    },
    {
      type: 'ol',
      children: [
        { type: 'li', children: [{ type: 'p', children: [{ text: 'First' }] }] },
        { type: 'li', children: [{ type: 'p', children: [{ text: 'Second' }] }] },
      ],
    },
    {
      type: 'blockquote',
      children: [{ type: 'p', children: [{ text: 'Legacy quote' }] }],
    },
  ] as Value;

  const markdown = plateToMarkdown(legacyValue);
  assert.ok(markdown.includes('- Alpha\n- Beta'));
  assert.ok(markdown.includes('1. First\n2. Second'));
  assert.ok(markdown.includes('> Legacy quote'));
});

test('markdownToPlate handles empty fenced code blocks and strips unsafe link schemes', () => {
  const markdown = [
    'Click [bad](javascript:alert(1)) or [safe](/workspace/123).',
    '',
    '```',
    '```',
  ].join('\n');

  const value = markdownToPlate(markdown) as Array<Record<string, unknown>>;
  const paragraphChildren = value[0].children as Array<Record<string, unknown>>;
  assert.equal(
    paragraphChildren.some((node) => node.url === 'javascript:alert(1)'),
    false
  );
  assertContainsMatch(paragraphChildren, { text: 'bad' });
  assertContainsMatch(paragraphChildren, { type: 'a', url: '/workspace/123' });

  assertMatchesObject(value[1], {
    type: 'code_block',
    children: [{ type: 'code_line', children: [{ text: '' }] }],
  });

  assert.equal(isSafeLinkUrl('https://example.com'), true);
  assert.equal(isSafeLinkUrl('javascript:alert(1)'), false);
  assert.equal(
    normalizeLinkInputUrl('example.com/wiki'),
    'https://example.com/wiki'
  );
  assert.equal(normalizeLinkInputUrl('javascript:void(0)'), null);
});
