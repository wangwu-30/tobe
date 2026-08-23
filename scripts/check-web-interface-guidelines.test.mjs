import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  checkWebInterfaceGuidelines,
  findWebInterfaceViolations,
  formatWebInterfaceViolations,
  webInterfaceRoots,
} from './check-web-interface-guidelines.mjs';

test('scans the complete Web UI source boundary', () => {
  assert.deepEqual(webInterfaceRoots, [
    'src/app',
    'src/canvas',
    'src/components',
    'src/surfaces',
  ]);
});

test('finds high-confidence JSX anti-patterns in deterministic source order', () => {
  const file = path.resolve('/fixture/web.tsx');
  const source = `
    export function Fixture() {
      return (
        <>
          <Button size="icon"><Trash /></Button>
          <div className="text-muted-foreground/70">Muted copy</div>
          <div className="transition-all">Animated</div>
          <button className="outline-none">Action</button>
          <ScrollArea className="min-h-0 flex-1">Content</ScrollArea>
          <meta name="viewport" content="width=device-width, maximum-scale=1" />
        </>
      );
    }
  `;

  assert.deepEqual(
    findWebInterfaceViolations(source, file).map(
      ({ line, rule }) => ({ line, rule })
    ),
    [
      { line: 5, rule: 'icon-button-name' },
      { line: 6, rule: 'muted-text-opacity' },
      { line: 7, rule: 'transition-all' },
      { line: 8, rule: 'focus-visible' },
      { line: 9, rule: 'scroll-region-focus' },
      { line: 10, rule: 'viewport-zoom' },
    ]
  );
});

test('accepts named icon controls, keyboard ScrollArea viewports, and focus replacements', () => {
  const source = `
    export function Fixture() {
      return (
        <>
          <Button aria-label="Delete item" size="icon"><Trash /></Button>
          <Button size="icon"><span className="sr-only">Delete item</span><Trash /></Button>
          <Button size="icon" {...props}><Trash /></Button>
          <ScrollArea viewportProps={{ 'aria-labelledby': headingId, tabIndex: 0 }}>Content</ScrollArea>
          <button className="outline-none focus-visible:ring-2">Action</button>
          <div className="text-muted-foreground">Muted copy</div>
          <input className="placeholder:text-muted-foreground/70" />
        </>
      );
    }
  `;

  assert.deepEqual(findWebInterfaceViolations(source, '/fixture/pass.tsx'), []);
});

test('does not treat prose or nonliteral composition as JSX violations', () => {
  const source = `
    // <Button size="icon"><Trash /></Button>
    const prose = 'transition-all text-muted-foreground/50';
    const className = cn('overflow-y-auto', dynamicClassName);
    export const fixture = <div className={className}>{prose}</div>;
  `;
  assert.deepEqual(findWebInterfaceViolations(source, '/fixture/prose.tsx'), []);
});

test('fails closed when a Web source file cannot be parsed', () => {
  assert.throws(
    () =>
      findWebInterfaceViolations(
        'export const broken = <Button size="icon">;',
        '/fixture/broken.tsx'
      ),
    /broken\.tsx:1:\d+ could not be parsed/u
  );
});

test('formats stable repo-relative diagnostics', () => {
  const root = path.resolve('/fixture');
  assert.equal(
    formatWebInterfaceViolations(
      [
        {
          column: 7,
          file: path.join(root, 'src/components/example.tsx'),
          line: 12,
          message: 'example violation',
          rule: 'example-rule',
        },
      ],
      root
    ),
    [
      '[verify:iteration:web-interface] static anti-pattern scan failed.',
      'Fix these high-confidence Web Interface Guidelines violations:',
      '  - src/components/example.tsx:12:7 [example-rule] example violation',
    ].join('\n')
  );
});

test('fails closed when discovery reports violations or cannot scan', async () => {
  await assert.rejects(
    checkWebInterfaceGuidelines({
      discoverViolations: async () => [
        {
          column: 1,
          file: '/fixture/src/app/page.tsx',
          line: 3,
          message: 'missing name',
          rule: 'icon-button-name',
        },
      ],
      root: '/fixture',
    }),
    /src\/app\/page\.tsx:3:1 \[icon-button-name\] missing name/u
  );

  await assert.rejects(
    checkWebInterfaceGuidelines({
      discoverViolations: async () => {
        throw new Error('EACCES while reading Web UI');
      },
    }),
    /EACCES while reading Web UI/u
  );
});
