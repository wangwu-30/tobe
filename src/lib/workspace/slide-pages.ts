import type { Value } from 'platejs';

export type SlidePageNode = {
  children?: Array<Record<string, unknown>>;
  id?: string;
  notes?: string;
  title?: string;
  type: 'slide_page';
};

export type SlidePageCard = {
  body: string[];
  id: string;
  notes: string | null;
  title: string;
};

export function isSlidePageNode(node: unknown): node is SlidePageNode {
  return (
    Boolean(node) &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    (node as { type?: unknown }).type === 'slide_page'
  );
}

export function extractSlidePageCards(
  value: Value | null | undefined,
  fallbackTitle: string
): SlidePageCard[] {
  const nodes = Array.isArray(value) ? value : [];
  const explicitSlides = nodes
    .filter(isSlidePageNode)
    .map((node, index) => {
      const titleSource =
        normalizeSlideLine(typeof node.title === 'string' ? node.title : null) ||
        extractLeadHeading(node.children) ||
        `${fallbackTitle} ${index + 1}`;
      const bodyNodes =
        !normalizeSlideLine(typeof node.title === 'string' ? node.title : null) &&
        extractLeadHeading(node.children)
          ? (node.children || []).slice(1)
          : node.children || [];

      return {
        body: extractBodyLines(bodyNodes),
        id: typeof node.id === 'string' && node.id.trim() ? node.id.trim() : `slide-${index}`,
        notes: normalizeSlideLine(typeof node.notes === 'string' ? node.notes : null) || null,
        title: titleSource,
      } satisfies SlidePageCard;
    })
    .filter((slide) => slide.title.trim() || slide.body.length > 0);

  if (explicitSlides.length > 0) {
    return explicitSlides;
  }

  return extractLegacySlides(nodes, fallbackTitle);
}

function extractLegacySlides(value: Value, fallbackTitle: string) {
  const slides: SlidePageCard[] = [];
  let current: { body: string[]; title: string } | null = null;

  const commitCurrent = () => {
    if (!current) {
      return;
    }

    const title = normalizeSlideLine(current.title) || fallbackTitle;
    if (!title && current.body.length === 0) {
      current = null;
      return;
    }

    slides.push({
      body: current.body.filter(Boolean),
      id: `slide-${slides.length}`,
      notes: null,
      title: title || fallbackTitle,
    });
    current = null;
  };

  for (const node of value) {
    if (isHeadingNode(node)) {
      commitCurrent();
      current = {
        body: [],
        title: extractNodeText(node),
      };
      continue;
    }

    const lines = extractBodyLines([node as Record<string, unknown>]);
    if (lines.length === 0) {
      continue;
    }

    if (!current) {
      current = {
        body: [],
        title: fallbackTitle,
      };
    }

    current.body.push(...lines);
  }

  commitCurrent();
  return slides;
}

function extractLeadHeading(children: Array<Record<string, unknown>> | undefined) {
  const firstChild = children?.[0];
  return firstChild && isHeadingNode(firstChild) ? normalizeSlideLine(extractNodeText(firstChild)) : '';
}

function extractBodyLines(nodes: Array<Record<string, unknown>>) {
  return nodes
    .map((node) => normalizeSlideLine(extractNodeText(node)))
    .filter(Boolean);
}

function isHeadingNode(node: unknown) {
  return (
    Boolean(node) &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    /^h[1-6]$/.test(String((node as { type?: unknown }).type || ''))
  );
}

function extractNodeText(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return '';
  }

  if ('text' in (node as Record<string, unknown>)) {
    return typeof (node as { text?: unknown }).text === 'string'
      ? (node as { text: string }).text
      : '';
  }

  const children = Array.isArray((node as { children?: unknown }).children)
    ? ((node as { children: unknown[] }).children as unknown[])
    : [];

  return children
    .map((child) => extractNodeText(child))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSlideLine(line: string | null | undefined) {
  return (line || '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
