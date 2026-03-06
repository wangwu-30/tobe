import type { Value } from 'platejs';

// Convert Plate JSON to Markdown for AI context
export function plateToMarkdown(value: Value): string {
  return value.map(nodeToMarkdown).join('\n');
}

function nodeToMarkdown(node: any, depth = 0): string {
  if (!node.type && node.text !== undefined) {
    return inlineToMarkdown(node);
  }

  const children = node.children
    ?.map((child: any) => {
      if (child.text !== undefined) return inlineToMarkdown(child);
      return nodeToMarkdown(child, depth + 1);
    })
    .join('') || '';

  switch (node.type) {
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
    case 'blockquote':
      return `> ${children}\n`;
    case 'code_block':
      return `\`\`\`${node.lang || ''}\n${children}\n\`\`\`\n`;
    case 'code_line':
      return children + '\n';
    case 'ul':
      return children;
    case 'ol':
      return children;
    case 'li':
      return `${'  '.repeat(depth > 0 ? depth - 1 : 0)}- ${children}\n`;
    case 'hr':
      return '---\n';
    case 'p':
    default:
      return `${children}\n`;
  }
}

function inlineToMarkdown(node: any): string {
  let text = node.text || '';
  if (node.bold) text = `**${text}**`;
  if (node.italic) text = `*${text}*`;
  if (node.strikethrough) text = `~~${text}~~`;
  if (node.code) text = `\`${text}\``;
  if (node.underline) text = `<u>${text}</u>`;
  return text;
}

// Convert Markdown string to Plate JSON value
export function markdownToPlate(markdown: string): Value {
  const lines = markdown.split('\n');
  const nodes: Value = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      nodes.push({
        type: 'code_block',
        lang,
        children: codeLines.map(l => ({
          type: 'code_line',
          children: [{ text: l }],
        })),
      } as any);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      nodes.push({ type: 'hr', children: [{ text: '' }] } as any);
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      nodes.push({
        type: `h${level}`,
        children: parseInline(headingMatch[2]),
      } as any);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      nodes.push({
        type: 'blockquote',
        children: [{ type: 'p', children: parseInline(line.slice(2)) }],
      } as any);
      i++;
      continue;
    }

    // Unordered list item
    if (/^\s*[-*+]\s+/.test(line)) {
      const listItems: any[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*[-*+]\s+/, '');
        listItems.push({
          type: 'li',
          children: [{ type: 'p', children: parseInline(content) }],
        });
        i++;
      }
      nodes.push({ type: 'ul', children: listItems } as any);
      continue;
    }

    // Ordered list item
    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems: any[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*\d+\.\s+/, '');
        listItems.push({
          type: 'li',
          children: [{ type: 'p', children: parseInline(content) }],
        });
        i++;
      }
      nodes.push({ type: 'ol', children: listItems } as any);
      continue;
    }

    // Paragraph
    nodes.push({
      type: 'p',
      children: parseInline(line),
    } as any);
    i++;
  }

  if (nodes.length === 0) {
    nodes.push({ type: 'p', children: [{ text: '' }] } as any);
  }

  return nodes;
}

function parseInline(text: string): any[] {
  const result: any[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold
    let match = remaining.match(/^\*\*(.+?)\*\*/);
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
    match = remaining.match(/^[^*`~]+/);
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
