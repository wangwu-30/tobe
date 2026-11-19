export type KnowledgeChunkV1 = {
  chunkIndex: number;
  content: string;
  endOffset: number;
  heading: string;
  path: string;
  startOffset: number;
};

export type ChunkKnowledgeDocumentInput = {
  content: string;
  maxChunkChars?: number;
  overlapChars?: number;
  path: string;
};

const DEFAULT_MAX_CHUNK_CHARS = 1_200;
const DEFAULT_OVERLAP_CHARS = 120;
const HEADING_LINE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

type RawSection = {
  endOffset: number;
  heading: string;
  startOffset: number;
};

/**
 * Deterministically splits a Markdown or plain-text knowledge document into
 * heading-aware bounded chunks with exact UTF-16 character offsets.
 */
export function chunkKnowledgeDocument(
  input: ChunkKnowledgeDocumentInput
): KnowledgeChunkV1[] {
  const { content, path } = input;
  const maxChunkChars = Math.max(
    128,
    Math.floor(input.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS)
  );
  const overlapChars = Math.max(
    0,
    Math.min(
      Math.floor(maxChunkChars / 3),
      Math.floor(input.overlapChars ?? DEFAULT_OVERLAP_CHARS)
    )
  );

  if (!content.trim()) {
    return [];
  }

  const sections = splitIntoHeadingSections(content);
  const chunks: KnowledgeChunkV1[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const sliceRanges = splitSectionRange(
      content,
      section.startOffset,
      section.endOffset,
      maxChunkChars,
      overlapChars
    );
    for (const range of sliceRanges) {
      const raw = content.slice(range.startOffset, range.endOffset);
      if (!raw.trim()) continue;
      chunks.push({
        chunkIndex,
        content: raw,
        endOffset: range.endOffset,
        heading: section.heading,
        path,
        startOffset: range.startOffset,
      });
      chunkIndex += 1;
    }
  }

  if (chunks.length === 0) {
    const trimmedEnd = Math.min(content.length, maxChunkChars);
    chunks.push({
      chunkIndex: 0,
      content: content.slice(0, trimmedEnd),
      endOffset: trimmedEnd,
      heading: '',
      path,
      startOffset: 0,
    });
  }

  return chunks;
}

function splitIntoHeadingSections(content: string): RawSection[] {
  const sections: RawSection[] = [];
  const headingStack: Array<{ level: number; text: string }> = [];
  let currentStart = 0;
  let currentHeading = '';
  let inFence = false;
  let offset = 0;

  while (offset < content.length) {
    const nextNewline = content.indexOf('\n', offset);
    const lineEnd = nextNewline === -1 ? content.length : nextNewline;
    const rawLine = content.slice(offset, lineEnd).replace(/\r$/, '');
    const trimmed = rawLine.trim();

    if (/^(?:```|~~~)/.test(trimmed)) {
      inFence = !inFence;
    } else if (!inFence) {
      const match = HEADING_LINE.exec(trimmed);
      if (match) {
        if (offset > currentStart && content.slice(currentStart, offset).trim()) {
          sections.push({
            endOffset: offset,
            heading: currentHeading,
            startOffset: currentStart,
          });
        }
        const level = match[1].length;
        const text = match[2].trim();
        while (
          headingStack.length > 0 &&
          headingStack[headingStack.length - 1].level >= level
        ) {
          headingStack.pop();
        }
        headingStack.push({ level, text });
        currentHeading = headingStack.map((item) => item.text).join(' > ');
        currentStart = offset;
      }
    }

    offset = nextNewline === -1 ? content.length : nextNewline + 1;
  }

  if (currentStart < content.length && content.slice(currentStart).trim()) {
    sections.push({
      endOffset: content.length,
      heading: currentHeading,
      startOffset: currentStart,
    });
  }

  return sections;
}

function splitSectionRange(
  content: string,
  sectionStart: number,
  sectionEnd: number,
  maxChunkChars: number,
  overlapChars: number
): Array<{ startOffset: number; endOffset: number }> {
  if (sectionEnd - sectionStart <= maxChunkChars) {
    return [{ endOffset: sectionEnd, startOffset: sectionStart }];
  }

  const ranges: Array<{ startOffset: number; endOffset: number }> = [];
  let cursor = sectionStart;

  while (cursor < sectionEnd) {
    const hardEnd = Math.min(sectionEnd, cursor + maxChunkChars);
    let end = hardEnd;

    if (hardEnd < sectionEnd) {
      const windowText = content.slice(cursor, hardEnd);
      const minBreak = Math.floor(maxChunkChars * 0.5);
      const paragraphBreak = windowText.lastIndexOf('\n\n');
      const lineBreak = windowText.lastIndexOf('\n');
      const spaceBreak = windowText.lastIndexOf(' ');

      if (paragraphBreak >= minBreak) {
        end = cursor + paragraphBreak + 2;
      } else if (lineBreak >= minBreak) {
        end = cursor + lineBreak + 1;
      } else if (spaceBreak >= minBreak) {
        end = cursor + spaceBreak + 1;
      }
    }

    if (end <= cursor) {
      end = hardEnd;
    }

    ranges.push({ endOffset: end, startOffset: cursor });
    if (end >= sectionEnd) break;

    const nextCursor = Math.max(cursor + 1, end - overlapChars);
    cursor = nextCursor;
  }

  return ranges;
}
