import { expect, test } from '@playwright/test';
import type { Value } from 'platejs';

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

  expect(value[0]).toMatchObject({ type: 'h1' });
  expect(value[1]).toMatchObject({
    type: 'p',
    children: expect.arrayContaining([
      expect.objectContaining({
        type: 'a',
        url: 'https://platejs.org',
      }),
      expect.objectContaining({ bold: true, text: 'bold' }),
      expect.objectContaining({ italic: true, text: 'italic' }),
      expect.objectContaining({ code: true, text: 'code' }),
      expect.objectContaining({ strikethrough: true, text: 'old' }),
    ]),
  });

  // Unordered list items use Plate 52 indent-based lists
  expect(value[2]).toMatchObject({
    type: 'p',
    indent: 1,
    listStyleType: 'disc',
  });
  expect(value[3]).toMatchObject({
    type: 'p',
    indent: 2,
    listStyleType: 'disc',
  });
  expect(value[4]).toMatchObject({
    type: 'p',
    indent: 1,
    listStyleType: 'disc',
  });

  // Ordered list items preserve sequential listStart
  expect(value[5]).toMatchObject({
    type: 'p',
    indent: 1,
    listStart: 1,
    listStyleType: 'decimal',
  });
  expect(value[6]).toMatchObject({
    type: 'p',
    indent: 1,
    listStart: 2,
    listStyleType: 'decimal',
  });

  // Blockquote and code block
  expect(value[7]).toMatchObject({ type: 'blockquote' });
  expect(value[8]).toMatchObject({
    type: 'code_block',
    lang: 'typescript',
    children: [
      { type: 'code_line', children: [{ text: 'const answer = 42;' }] },
      { type: 'code_line', children: [{ text: 'console.log(answer);' }] },
    ],
  });

  // Round-trip back to Markdown preserves structure
  const roundTripped = plateToMarkdown(value as Value);
  expect(roundTripped).toContain('# Wiki Guide');
  expect(roundTripped).toContain('[Plate Docs](https://platejs.org)');
  expect(roundTripped).toContain('- First bullet');
  expect(roundTripped).toContain('  - Nested bullet');
  expect(roundTripped).toContain('1. Step one');
  expect(roundTripped).toContain('2. Step two');
  expect(roundTripped).toContain('> Important callout');
  expect(roundTripped).toContain(
    '```typescript\nconst answer = 42;\nconsole.log(answer);\n```'
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
  expect(markdown).toContain('- Alpha\n- Beta');
  expect(markdown).toContain('1. First\n2. Second');
  expect(markdown).toContain('> Legacy quote');
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
  expect(paragraphChildren.some((node) => node.url === 'javascript:alert(1)')).toBe(
    false
  );
  expect(paragraphChildren).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: 'bad' }),
      expect.objectContaining({ type: 'a', url: '/workspace/123' }),
    ])
  );

  expect(value[1]).toMatchObject({
    type: 'code_block',
    children: [{ type: 'code_line', children: [{ text: '' }] }],
  });

  expect(isSafeLinkUrl('https://example.com')).toBe(true);
  expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false);
  expect(normalizeLinkInputUrl('example.com/wiki')).toBe(
    'https://example.com/wiki'
  );
  expect(normalizeLinkInputUrl('javascript:void(0)')).toBeNull();
});
