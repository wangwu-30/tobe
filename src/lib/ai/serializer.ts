import type { TElement, TText, Value } from 'platejs';

const ORDERED_LIST_STYLE_TYPES = new Set([
  'decimal',
  'decimal-leading-zero',
  'lower-alpha',
  'lower-latin',
  'lower-roman',
  'upper-alpha',
  'upper-latin',
  'upper-roman',
]);

const UNORDERED_LIST_STYLE_TYPES = new Set([
  'disc',
  'circle',
  'square',
  'disclosure-closed',
  'disclosure-open',
]);

export function isSafeLinkUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith('/') || trimmed.startsWith('#')) {
    return true;
  }

  try {
    const parsed = new URL(trimmed);
    return (
      parsed.protocol === 'https:' ||
      parsed.protocol === 'http:' ||
      parsed.protocol === 'mailto:'
    );
  } catch {
    return false;
  }
}

const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  'c++': 'cpp',
  cs: 'csharp',
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  text: 'plaintext',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'plaintext',
  yml: 'yaml',
  zsh: 'bash',
};

export function normalizeCodeBlockLanguage(rawLang: string): string {
  const normalized = rawLang.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  return CODE_LANGUAGE_ALIASES[normalized] ?? normalized;
}

export function normalizeLinkInputUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  if (isSafeLinkUrl(trimmed)) {
    return trimmed;
  }

  // If the user typed a bare domain like "example.com/docs", default to https://
  if (
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) &&
    /^[^\s/]+\.[^\s/]+(?:\/.*)?$/.test(trimmed)
  ) {
    const withHttps = `https://${trimmed}`;
    return isSafeLinkUrl(withHttps) ? withHttps : null;
  }

  return null;
}

type SerializerNode = Record<string, unknown>;
type InlineNode = TText | TElement;

function asNodeList(value: unknown): SerializerNode[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is SerializerNode =>
          Boolean(item) && typeof item === 'object'
      )
    : [];
}

// Convert Plate JSON to Markdown for AI context
export function plateToMarkdown(value: Value): string {
  const orderedCounters = new Map<number, number>();
  const lines: string[] = [];

  for (const rawNode of asNodeList(value)) {
    const listStyleType =
      typeof rawNode.listStyleType === 'string' ? rawNode.listStyleType : null;

    if (listStyleType) {
      const indent =
        typeof rawNode.indent === 'number' && rawNode.indent >= 1
          ? Math.floor(rawNode.indent)
          : 1;
      const prefixIndent = '  '.repeat(Math.max(0, indent - 1));
      const content = renderInlineChildren(
        asNodeList(rawNode.children)
      ).trimEnd();

      // Reset counters for deeper indent levels
      for (const level of [...orderedCounters.keys()]) {
        if (level > indent) {
          orderedCounters.delete(level);
        }
      }

      if (ORDERED_LIST_STYLE_TYPES.has(listStyleType)) {
        const explicitStart =
          typeof rawNode.listStart === 'number' && rawNode.listStart >= 1
            ? Math.floor(rawNode.listStart)
            : null;
        const previous = orderedCounters.get(indent);
        const nextNumber =
          explicitStart !== null && previous === undefined
            ? explicitStart
            : (previous ?? 0) + 1;
        orderedCounters.set(indent, nextNumber);
        lines.push(`${prefixIndent}${nextNumber}. ${content}`);
      } else {
        orderedCounters.delete(indent);
        const marker =
          listStyleType === 'todo'
            ? rawNode.checked
              ? '- [x] '
              : '- [ ] '
            : '- ';
        lines.push(`${prefixIndent}${marker}${content}`);
      }
      continue;
    }

    orderedCounters.clear();
    lines.push(nodeToMarkdown(rawNode, 0));
  }

  return lines.join('\n');
}

function renderInlineChildren(children: SerializerNode[]): string {
  return children
    .map((child) => {
      if (child.text !== undefined && !child.type) {
        return inlineToMarkdown(child);
      }
      if (child.type === 'a') {
        const label = renderInlineChildren(asNodeList(child.children));
        const url = typeof child.url === 'string' ? child.url : '';
        return url ? `[${label}](${url})` : label;
      }
      return nodeToMarkdown(child, 0);
    })
    .join('');
}

function nodeToMarkdown(node: SerializerNode, depth = 0): string {
  if (!node.type && node.text !== undefined) {
    return inlineToMarkdown(node);
  }

  const nodeChildren = asNodeList(node.children);

  if (node.type === 'a') {
    const label = renderInlineChildren(nodeChildren);
    const url = typeof node.url === 'string' ? node.url : '';
    return url ? `[${label}](${url})` : label;
  }

  if (node.type === 'code_block') {
    const codeLines = nodeChildren.map((child) =>
      child.type === 'code_line'
        ? childrenToRawText(child.children)
        : child.text !== undefined
          ? String(child.text)
          : childrenToRawText(child.children)
    );
    const lang = typeof node.lang === 'string' ? node.lang : '';
    return `\`\`\`${lang}\n${codeLines.join('\n')}\n\`\`\`\n`;
  }

  if (node.type === 'code_line') {
    return childrenToRawText(node.children);
  }

  if (node.type === 'ul' || node.type === 'ol') {
    const isOrdered = node.type === 'ol';
    return nodeChildren
      .map((item, index) =>
        legacyListItemToMarkdown(item, depth, isOrdered ? index + 1 : null)
      )
      .join('');
  }

  if (node.type === 'li') {
    return legacyListItemToMarkdown(node, depth, null);
  }

  if (node.type === 'blockquote') {
    const text = nodeChildren
      .map((child) => {
        if (child.text !== undefined && !child.type) {
          return inlineToMarkdown(child);
        }
        if (child.type === 'p') {
          return renderInlineChildren(asNodeList(child.children));
        }
        return nodeToMarkdown(child, depth + 1).trimEnd();
      })
      .join('\n')
      .trimEnd();
    return `${text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}\n`;
  }

  const children = renderInlineChildren(nodeChildren);

  switch (node.type) {
    case 'slide_page': {
      const explicitTitle =
        typeof node.title === 'string' && node.title.trim()
          ? node.title.trim()
          : '';
      const firstChild = nodeChildren[0];
      const firstHeadingChild =
        !explicitTitle &&
        firstChild &&
        /^h[1-6]$/.test(String(firstChild.type || ''))
          ? firstChild
          : null;
      const derivedTitle = firstHeadingChild
        ? childrenToPlainText(firstHeadingChild.children)
        : '';
      const title = explicitTitle || derivedTitle || 'Slide';
      const bodyChildren = firstHeadingChild
        ? nodeChildren.slice(1)
        : nodeChildren;
      const body = bodyChildren
        .map((child) => nodeToMarkdown(child, depth + 1))
        .join('\n')
        .trim();
      const notes =
        typeof node.notes === 'string' && node.notes.trim()
          ? `\n> Notes: ${node.notes.trim()}`
          : '';
      return [`# ${title}`, body || '', notes].filter(Boolean).join('\n') + '\n';
    }
    case 'h1':
      return `# ${children}\n`;
    case 'h2':
      return `## ${children}\n`;
    case 'h3':
      return `### ${children}\n`;
    case 'h4':
      return `#### ${children}\n`;
    case 'h5':
      return `##### ${children}\n`;
    case 'h6':
      return `###### ${children}\n`;
    case 'hr':
      return '---\n';
    case 'p':
    default:
      return `${children}\n`;
  }
}

function legacyListItemToMarkdown(
  node: SerializerNode,
  depth: number,
  orderedIndex: number | null
): string {
  const indentPrefix = '  '.repeat(depth);
  const marker = orderedIndex !== null ? `${orderedIndex}. ` : '- ';
  const childNodes = asNodeList(node.children);
  const inlineParts: string[] = [];
  const nestedParts: string[] = [];

  for (const child of childNodes) {
    if (child.type === 'ul' || child.type === 'ol') {
      nestedParts.push(nodeToMarkdown(child, depth + 1));
    } else if (child.type === 'p' || child.type === 'lic') {
      inlineParts.push(renderInlineChildren(asNodeList(child.children)));
    } else if (child.text !== undefined && !child.type) {
      inlineParts.push(inlineToMarkdown(child));
    } else if (child.type === 'a') {
      inlineParts.push(nodeToMarkdown(child, depth + 1));
    } else {
      inlineParts.push(nodeToMarkdown(child, depth + 1).trimEnd());
    }
  }

  return `${indentPrefix}${marker}${inlineParts.join('').trimEnd()}\n${nestedParts.join('')}`;
}

function inlineToMarkdown(node: SerializerNode): string {
  let text = typeof node.text === 'string' ? node.text : '';
  if (!text) return '';
  if (node.code) text = `\`${text}\``;
  if (node.bold) text = `**${text}**`;
  if (node.italic) text = `*${text}*`;
  if (node.strikethrough) text = `~~${text}~~`;
  if (node.underline) text = `<u>${text}</u>`;
  return text;
}

function childrenToRawText(children: unknown): string {
  return asNodeList(children)
    .map((child) => {
      if ('text' in child) {
        return String(child.text || '');
      }
      if (Array.isArray(child.children)) {
        return childrenToRawText(child.children);
      }
      return '';
    })
    .join('');
}

function childrenToPlainText(children: unknown): string {
  return asNodeList(children)
    .map((child) => {
      if ('text' in child) {
        return String(child.text || '');
      }
      if (Array.isArray(child.children)) {
        return childrenToPlainText(child.children);
      }
      return '';
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeListIndent(leadingWhitespace: string): number {
  const expanded = leadingWhitespace.replace(/\t/g, '  ');
  return Math.min(6, Math.floor(expanded.length / 2) + 1);
}

// Convert Markdown string to Plate JSON value
export function markdownToPlate(markdown: string): Value {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const nodes: TElement[] = [];
  const orderedCounters = new Map<number, number>();
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      orderedCounters.clear();
      const lang = normalizeCodeBlockLanguage(line.slice(3));
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].startsWith('```')) {
        i++; // skip closing ```
      }
      const normalizedCodeLines = codeLines.length > 0 ? codeLines : [''];
      nodes.push({
        type: 'code_block',
        ...(lang ? { lang } : {}),
        children: normalizedCodeLines.map((codeLine) => ({
          type: 'code_line',
          children: [{ text: codeLine }],
        })),
      });
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      orderedCounters.clear();
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      orderedCounters.clear();
      nodes.push({ type: 'hr', children: [{ text: '' }] });
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      orderedCounters.clear();
      const level = headingMatch[1].length;
      nodes.push({
        type: `h${level}`,
        children: parseInline(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      orderedCounters.clear();
      nodes.push({
        type: 'blockquote',
        children: parseInline(line.slice(2)),
      });
      i++;
      continue;
    }

    // Unordered list item -> Plate 52 indent-based list paragraph
    const unorderedMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (unorderedMatch) {
      const indent = computeListIndent(unorderedMatch[1]);
      for (const level of [...orderedCounters.keys()]) {
        if (level >= indent) {
          orderedCounters.delete(level);
        }
      }
      nodes.push({
        type: 'p',
        indent,
        listStyleType: 'disc',
        children: parseInline(unorderedMatch[2]),
      });
      i++;
      continue;
    }

    // Ordered list item -> Plate 52 indent-based list paragraph
    const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      const indent = computeListIndent(orderedMatch[1]);
      const parsedNum = Number.parseInt(orderedMatch[2], 10);
      for (const level of [...orderedCounters.keys()]) {
        if (level > indent) {
          orderedCounters.delete(level);
        }
      }
      const previous = orderedCounters.get(indent);
      const listStart =
        previous === undefined
          ? Number.isFinite(parsedNum) && parsedNum >= 1
            ? parsedNum
            : 1
          : previous + 1;
      orderedCounters.set(indent, listStart);

      nodes.push({
        type: 'p',
        indent,
        listStart,
        listStyleType: 'decimal',
        children: parseInline(orderedMatch[3]),
      });
      i++;
      continue;
    }

    // Paragraph
    orderedCounters.clear();
    nodes.push({
      type: 'p',
      children: parseInline(line),
    });
    i++;
  }

  if (nodes.length === 0) {
    nodes.push({ type: 'p', children: [{ text: '' }] });
  }

  return nodes;
}

function parseInline(text: string): InlineNode[] {
  const result: InlineNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Markdown link: [label](url)
    let match = remaining.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (match) {
      const label = match[1];
      const url = match[2];
      if (isSafeLinkUrl(url)) {
        result.push({
          type: 'a',
          url,
          children: parseInline(label),
        });
      } else {
        result.push({ text: label });
      }
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Bold
    match = remaining.match(/^\*\*(.+?)\*\*/);
    if (match) {
      result.push({ text: match[1], bold: true });
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Italic
    match = remaining.match(/^\*(.+?)\*/);
    if (match) {
      result.push({ text: match[1], italic: true });
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Code
    match = remaining.match(/^`(.+?)`/);
    if (match) {
      result.push({ text: match[1], code: true });
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Strikethrough
    match = remaining.match(/^~~(.+?)~~/);
    if (match) {
      result.push({ text: match[1], strikethrough: true });
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Plain text up to next special char
    match = remaining.match(/^[^*`~[]+/);
    if (match) {
      result.push({ text: match[0] });
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Single special char
    result.push({ text: remaining[0] });
    remaining = remaining.slice(1);
  }

  if (result.length === 0) {
    result.push({ text: '' });
  }

  return result;
}

export function isUnorderedListStyleType(value: unknown): boolean {
  return typeof value === 'string' && UNORDERED_LIST_STYLE_TYPES.has(value);
}
