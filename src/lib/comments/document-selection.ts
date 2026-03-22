import { safeJsonParse } from '@/framework/resilience';
import type { ReviewAnchorData, ReviewAnchorPointData } from '@/types';

export type DocumentSelectionRangeData = {
  start: ReviewAnchorPointData;
  end: ReviewAnchorPointData;
};

type TextLeafRef = {
  node: {
    text: string;
  };
  path: number[];
};

export function createStructuredDocumentSelectionRange(selection: {
  anchor: ReviewAnchorPointData;
  focus: ReviewAnchorPointData;
} | null | undefined): DocumentSelectionRangeData | null {
  if (!selection) {
    return null;
  }

  const start = sanitizeAnchorPoint(selection.anchor);
  const end = sanitizeAnchorPoint(selection.focus);
  if (!start || !end) {
    return null;
  }

  return compareAnchorPoints(start, end) <= 0
    ? { start, end }
    : { start: end, end: start };
}

export function getStructuredDocumentSelectionRange(
  reviewAnchor: ReviewAnchorData | null | undefined
): DocumentSelectionRangeData | null {
  if (
    !reviewAnchor ||
    reviewAnchor.surfaceType !== 'document-selection' ||
    reviewAnchor.bindingType !== 'selection'
  ) {
    return null;
  }

  return createStructuredDocumentSelectionRange({
    anchor: reviewAnchor.anchorPayload.start as ReviewAnchorPointData,
    focus: reviewAnchor.anchorPayload.end as ReviewAnchorPointData,
  });
}

export function isSingleBlockDocumentSelectionRange(
  range: DocumentSelectionRangeData | null | undefined
) {
  if (!range || range.start.path.length === 0 || range.end.path.length === 0) {
    return false;
  }

  return range.start.path[0] === range.end.path[0];
}

export function extractTextFromPlateRange(
  content: string,
  range: DocumentSelectionRangeData
) {
  const resolved = resolvePlateRange(content, range);
  if (!resolved) {
    return null;
  }

  const { endLeaf, endLeafIndex, leaves, startLeaf, startLeafIndex } = resolved;
  if (startLeafIndex === endLeafIndex) {
    return startLeaf.node.text.slice(range.start.offset, range.end.offset);
  }

  const parts = [startLeaf.node.text.slice(range.start.offset)];
  for (let index = startLeafIndex + 1; index < endLeafIndex; index += 1) {
    parts.push(leaves[index].node.text);
  }
  parts.push(endLeaf.node.text.slice(0, range.end.offset));
  return parts.join('');
}

export function replaceTextInPlateRange(
  content: string,
  range: DocumentSelectionRangeData,
  replacement: string
) {
  const resolved = resolvePlateRange(content, range);
  if (!resolved) {
    return null;
  }

  const { endLeaf, endLeafIndex, leaves, parsedValue, startLeaf, startLeafIndex } =
    resolved;
  if (startLeafIndex === endLeafIndex) {
    startLeaf.node.text =
      startLeaf.node.text.slice(0, range.start.offset) +
      replacement +
      startLeaf.node.text.slice(range.end.offset);
    return JSON.stringify(parsedValue);
  }

  startLeaf.node.text =
    startLeaf.node.text.slice(0, range.start.offset) + replacement;
  for (let index = startLeafIndex + 1; index < endLeafIndex; index += 1) {
    leaves[index].node.text = '';
  }
  endLeaf.node.text = endLeaf.node.text.slice(range.end.offset);
  return JSON.stringify(parsedValue);
}

function sanitizeAnchorPoint(
  value: ReviewAnchorPointData | null | undefined
): ReviewAnchorPointData | null {
  if (
    !value ||
    !Array.isArray(value.path) ||
    value.path.some((segment) => !Number.isInteger(segment) || segment < 0) ||
    !Number.isInteger(value.offset) ||
    value.offset < 0
  ) {
    return null;
  }

  return {
    path: [...value.path],
    offset: value.offset,
  };
}

function compareAnchorPoints(left: ReviewAnchorPointData, right: ReviewAnchorPointData) {
  const pathDelta = comparePathArrays(left.path, right.path);
  if (pathDelta !== 0) {
    return pathDelta;
  }

  return left.offset - right.offset;
}

function comparePathArrays(left: number[], right: number[]) {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return left.length - right.length;
}

function resolvePlateRange(content: string, range: DocumentSelectionRangeData) {
  if (!isSingleBlockDocumentSelectionRange(range)) {
    return null;
  }

  const parsedValue = safeJsonParse<unknown>(content, null);
  if (!Array.isArray(parsedValue)) {
    return null;
  }

  const blockIndex = range.start.path[0];
  const blockNode = parsedValue[blockIndex];
  if (!blockNode || typeof blockNode !== 'object') {
    return null;
  }

  const leaves: TextLeafRef[] = [];
  collectTextLeaves(blockNode, [blockIndex], leaves);

  const startLeafIndex = leaves.findIndex((leaf) =>
    comparePathArrays(leaf.path, range.start.path) === 0
  );
  const endLeafIndex = leaves.findIndex((leaf) =>
    comparePathArrays(leaf.path, range.end.path) === 0
  );

  if (startLeafIndex === -1 || endLeafIndex === -1 || startLeafIndex > endLeafIndex) {
    return null;
  }

  const startLeaf = leaves[startLeafIndex];
  const endLeaf = leaves[endLeafIndex];
  if (
    range.start.offset > startLeaf.node.text.length ||
    range.end.offset > endLeaf.node.text.length
  ) {
    return null;
  }

  return {
    parsedValue,
    leaves,
    startLeaf,
    startLeafIndex,
    endLeaf,
    endLeafIndex,
  };
}

function collectTextLeaves(node: unknown, path: number[], target: TextLeafRef[]) {
  if (!node || typeof node !== 'object') {
    return;
  }

  const textValue = (node as { text?: unknown }).text;
  if (typeof textValue === 'string') {
    target.push({
      node: node as { text: string },
      path,
    });
  }

  const children = (node as { children?: unknown }).children;
  if (!Array.isArray(children)) {
    return;
  }

  children.forEach((child, index) => {
    collectTextLeaves(child, [...path, index], target);
  });
}
