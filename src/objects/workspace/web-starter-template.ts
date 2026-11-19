import type { DeliverableType } from '@/types';

export function buildWorkspaceFileSeeds(params: {
  deliverableType: DeliverableType;
  heading: string;
  initialContent?: string | null;
}) {
  if (params.deliverableType === 'web') {
    return {
      additional: [
        {
          content: buildStaticWebStyles(),
          kind: 'code' as const,
          language: 'css',
          name: 'styles.css',
        },
      ],
      primary: {
        content: buildStaticWebIndexHtml(params.heading),
        kind: 'code' as const,
        language: 'html',
        name: 'index.html',
      },
    };
  }

  return {
    additional: [],
    primary: {
      content: params.initialContent || '[]',
      kind: 'richtext' as const,
      language: 'markdown',
      name: 'main',
    },
  };
}

export function slugProjectTitle(title: string) {
  const normalized = title
    .normalize('NFKC')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return normalized || 'project';
}

export function deriveWorkspaceTitle(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/[。！？!?,，；;：:]+$/g, '')
    .trim();

  if (!normalized) {
    return null;
  }

  const strippedLead = normalized.replace(
    /^(写一份|写一个|写一篇|做一份|做一个|做一页|生成一份|生成一个|创建一份|创建一个|起草一份|产出一份)\s*/u,
    ''
  );
  const firstClause = strippedLead.split(/[，。,.：:]/u)[0]?.trim() || strippedLead;
  const candidate = firstClause || strippedLead;

  return candidate.length > 28 ? `${candidate.slice(0, 25).trimEnd()}…` : candidate;
}

export function mergeIntentDetailIntoConstraints(
  constraints: string | null,
  selectedIntentNote: string | null
) {
  const detail = selectedIntentNote?.trim() || '';
  const base = constraints?.trim() || '';

  if (!detail) {
    return base || null;
  }

  return [base, `Supplementary result-shape note: ${detail}`]
    .filter(Boolean)
    .join('\n\n');
}

export function buildCompanionWebWorkspaceTitle(
  title: string,
  language: string | null
) {
  const trimmedTitle = title.trim() || 'Untitled Project';
  return language?.startsWith('zh')
    ? `${trimmedTitle} 配套网页`
    : `${trimmedTitle} Companion Site`;
}

function buildStaticWebIndexHtml(title: unknown) {
  const heading = escapeHtmlText(
    typeof title === 'string' && title.trim().length > 0
      ? title.trim()
      : 'New Web Deliverable'
  );

  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${heading}</title>`,
    '    <link rel="stylesheet" href="./styles.css" />',
    '  </head>',
    '  <body>',
    '    <main class="page-shell">',
    '      <section class="hero-card">',
    '        <p class="eyebrow">Web deliverable</p>',
    `        <h1>${heading}</h1>`,
    '        <p class="lede">',
    '          This workspace starts with a previewable page shell that works fully offline.',
    '          Replace the sections, copy, and styling with the real page during the first',
    '          author pass.',
    '        </p>',
    '        <div class="cta-row">',
    '          <a class="primary-cta" href="#sections">Review the visible result</a>',
    '          <a class="secondary-cta" href="#notes">Refine the structure</a>',
    '        </div>',
    '      </section>',
    '      <section id="sections" class="content-grid">',
    '        <article class="detail-card">',
    '          <p class="card-label">Section</p>',
    '          <h2>Hero</h2>',
    '          <p>Start from the visible result, then rewrite the copy and hierarchy in place.</p>',
    '        </article>',
    '        <article class="detail-card">',
    '          <p class="card-label">Section</p>',
    '          <h2>Proof</h2>',
    '          <p>Add highlights, social proof, or supporting facts here once the main story is clear.</p>',
    '        </article>',
    '        <article id="notes" class="detail-card">',
    '          <p class="card-label">Section</p>',
    '          <h2>Next step</h2>',
    '          <p>Keep the live page readable first. Only open the implementation view when you truly need to edit the source.</p>',
    '        </article>',
    '      </section>',
    '    </main>',
    '  </body>',
    '</html>',
  ].join('\n');
}

function buildStaticWebStyles() {
  return [
    ':root {',
    '  color-scheme: light;',
    "  font-family: 'SF Pro Display', 'Helvetica Neue', sans-serif;",
    '  background: linear-gradient(180deg, #f5f1e8 0%, #f9f7f3 100%);',
    '  color: #171717;',
    '}',
    '',
    '* {',
    '  box-sizing: border-box;',
    '}',
    '',
    'body {',
    '  margin: 0;',
    '  min-height: 100vh;',
    '  background: radial-gradient(circle at top, rgba(201, 153, 66, 0.16), transparent 32%),',
    '    linear-gradient(180deg, #f5f1e8 0%, #f9f7f3 100%);',
    '}',
    '',
    '.page-shell {',
    '  min-height: 100vh;',
    '  display: grid;',
    '  place-items: center;',
    '  padding: 32px;',
    '}',
    '',
    '.hero-card {',
    '  width: min(720px, 100%);',
    '  padding: 48px;',
    '  border-radius: 32px;',
    '  background: rgba(255, 255, 255, 0.88);',
    '  border: 1px solid rgba(23, 23, 23, 0.08);',
    '  box-shadow: 0 24px 80px rgba(60, 44, 12, 0.12);',
    '}',
    '',
    '.cta-row {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 12px;',
    '  margin-top: 28px;',
    '}',
    '',
    '.primary-cta,',
    '.secondary-cta {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  min-height: 44px;',
    '  padding: 0 18px;',
    '  border-radius: 999px;',
    '  text-decoration: none;',
    '  font-size: 14px;',
    '  font-weight: 600;',
    '  transition: transform 180ms ease, box-shadow 180ms ease;',
    '}',
    '',
    '.primary-cta {',
    '  color: #fff;',
    '  background: linear-gradient(135deg, #111827, #8a6a2f);',
    '  box-shadow: 0 18px 40px rgba(23, 23, 23, 0.18);',
    '}',
    '',
    '.secondary-cta {',
    '  color: #171717;',
    '  background: rgba(255, 255, 255, 0.72);',
    '  border: 1px solid rgba(23, 23, 23, 0.08);',
    '}',
    '',
    '.primary-cta:hover,',
    '.secondary-cta:hover {',
    '  transform: translateY(-1px);',
    '}',
    '',
    '.content-grid {',
    '  width: min(960px, 100%);',
    '  display: grid;',
    '  gap: 18px;',
    '  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));',
    '  margin-top: 20px;',
    '}',
    '',
    '.detail-card {',
    '  border-radius: 24px;',
    '  background: rgba(255, 255, 255, 0.82);',
    '  border: 1px solid rgba(23, 23, 23, 0.08);',
    '  padding: 24px;',
    '  box-shadow: 0 18px 60px rgba(60, 44, 12, 0.08);',
    '}',
    '',
    '.card-label {',
    '  margin: 0 0 8px;',
    '  font-size: 11px;',
    '  letter-spacing: 0.18em;',
    '  text-transform: uppercase;',
    '  color: rgba(23, 23, 23, 0.45);',
    '}',
    '',
    '.detail-card h2 {',
    '  margin: 0;',
    '  font-size: 20px;',
    '  line-height: 1.2;',
    '}',
    '',
    '.detail-card p:last-child {',
    '  margin-bottom: 0;',
    '}',
    '',
    '.eyebrow {',
    '  margin: 0 0 12px;',
    '  font-size: 12px;',
    '  letter-spacing: 0.24em;',
    '  text-transform: uppercase;',
    '  color: #8a6a2f;',
    '}',
    '',
    'h1 {',
    '  margin: 0;',
    '  font-size: clamp(2.6rem, 5vw, 4.4rem);',
    '  line-height: 0.95;',
    '}',
    '',
    '.lede {',
    '  margin: 18px 0 0;',
    '  max-width: 56ch;',
    '  font-size: 16px;',
    '  line-height: 1.7;',
    '  color: rgba(23, 23, 23, 0.72);',
    '}',
    '',
    '@media (max-width: 640px) {',
    '  .page-shell {',
    '    padding: 18px;',
    '  }',
    '',
    '  .hero-card {',
    '    padding: 28px;',
    '    border-radius: 24px;',
    '  }',
    '',
    '  .cta-row {',
    '    flex-direction: column;',
    '  }',
    '}',
  ].join('\n');
}

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
