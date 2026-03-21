import {
  extractReviewAnchorIdentityCandidates,
  extractReviewAnchorSearchCandidates,
} from '@/lib/comments/review-anchor';
import type {
  CommentThreadData,
  CommentThreadInheritanceState,
} from '@/types';

export type CommentThreadSurfaceFile = {
  content: string;
  id: string | null;
  path: string;
};

export function classifyInheritedCommentThread(params: {
  combinedSurfaceText: string;
  directIdentityCandidates: Set<string>;
  directFingerprints: Set<string>;
  seenInheritedIdentityCandidates: Set<string>;
  seenInheritedFingerprints: Set<string>;
  surfaceFilesById: Map<string, CommentThreadSurfaceFile>;
  thread: CommentThreadData;
}): CommentThreadInheritanceState {
  if (
    !canMapThreadToCurrentSurface({
      combinedSurfaceText: params.combinedSurfaceText,
      surfaceFilesById: params.surfaceFilesById,
      thread: params.thread,
    })
  ) {
    return 'stale';
  }

  if (
    params.directFingerprints.has(params.thread.anchorFingerprint) ||
    params.seenInheritedFingerprints.has(params.thread.anchorFingerprint) ||
    collectCommentThreadIdentityCandidates(params.thread).some(
      (candidate) =>
        params.directIdentityCandidates.has(candidate) ||
        params.seenInheritedIdentityCandidates.has(candidate)
    )
  ) {
    return 'superseded';
  }

  return 'actionable';
}

export function collectCommentThreadIdentityCandidates(thread: CommentThreadData) {
  return extractReviewAnchorIdentityCandidates({
    anchorText: thread.anchorText,
    reviewAnchor: thread.reviewAnchor,
  }).map((candidate) => normalizeSearchText(candidate));
}

export function buildCommentSurfaceText(surfaceFiles: CommentThreadSurfaceFile[]) {
  return surfaceFiles.map((file) => buildSearchableContent(file.content)).join('\n');
}

function canMapThreadToCurrentSurface(params: {
  combinedSurfaceText: string;
  surfaceFilesById: Map<string, CommentThreadSurfaceFile>;
  thread: CommentThreadData;
}) {
  const fileContent =
    params.thread.fileId !== null
      ? params.surfaceFilesById.get(params.thread.fileId)?.content || null
      : null;
  const fileSearchableContent =
    fileContent !== null ? buildSearchableContent(fileContent) : null;
  if (isWebComponentThread(params.thread)) {
    return canMapWebThreadToCurrentSurface({
      combinedSurfaceText: params.combinedSurfaceText,
      fileSearchableContent,
      thread: params.thread,
    });
  }

  const anchorCandidates = collectAnchorCandidates(params.thread);
  if (anchorCandidates.length === 0) {
    return true;
  }

  if (
    fileSearchableContent !== null &&
    anchorCandidates.some((candidate) => fileSearchableContent.includes(candidate))
  ) {
    return true;
  }

  return params.thread.fileId !== null
    ? false
    : anchorCandidates.some((candidate) => params.combinedSurfaceText.includes(candidate));
}

function collectAnchorCandidates(thread: CommentThreadData) {
  return extractReviewAnchorSearchCandidates({
    anchorText: thread.anchorText,
    reviewAnchor: thread.reviewAnchor,
  }).map((candidate) => normalizeSearchText(candidate));
}

function canMapWebThreadToCurrentSurface(params: {
  combinedSurfaceText: string;
  fileSearchableContent: string | null;
  thread: CommentThreadData;
}) {
  const searchTargets = Array.from(
    new Set(
      [params.fileSearchableContent, params.combinedSurfaceText]
        .map((value) => value?.trim() || '')
        .filter(Boolean)
    )
  );

  if (searchTargets.length === 0) {
    return true;
  }

  return searchTargets.some((target) => webSelectorStillResolvable(target, params.thread)) ||
    searchTargets.some((target) => webExcerptStillResolvable(target, params.thread)) ||
    searchTargets.some((target) => webDomContextStillResolvable(target, params.thread));
}

function webSelectorStillResolvable(searchableContent: string, thread: CommentThreadData) {
  return collectWebSelectorSourceCandidates(thread).some((candidate) =>
    searchableContent.includes(candidate)
  );
}

function collectWebSelectorSourceCandidates(thread: CommentThreadData) {
  const selector = readReviewAnchorPayloadString(thread, ['cssSelector', 'selector']);
  if (!selector) {
    return [];
  }

  const candidates = new Set<string>();
  candidates.add(normalizeSearchText(selector));

  const selectorIds = Array.from(selector.matchAll(/#([A-Za-z][A-Za-z0-9_-]*)/g)).map(
    (match) => match[1]
  );
  selectorIds.forEach((id) => {
    candidates.add(normalizeSearchText(`id="${id}"`));
    candidates.add(normalizeSearchText(`id='${id}'`));
    candidates.add(normalizeSearchText(`"id":"${id}"`));
    candidates.add(normalizeSearchText(`'id':'${id}'`));
  });

  return [...candidates];
}

function webExcerptStillResolvable(searchableContent: string, thread: CommentThreadData) {
  const excerpt = normalizeSearchText(
    readReviewAnchorPayloadString(thread, ['excerpt']) || thread.anchorText || ''
  );
  return excerpt.length >= 6 && searchableContent.includes(excerpt);
}

function webDomContextStillResolvable(searchableContent: string, thread: CommentThreadData) {
  const domContext = readReviewAnchorPayloadString(thread, ['domContext']);
  const normalizedContext = normalizeSearchText(domContext || '');
  if (normalizedContext.length >= 24 && searchableContent.includes(normalizedContext)) {
    return true;
  }

  const stableSegments = String(domContext || '')
    .split('|')
    .map((segment) => normalizeSearchText(segment))
    .filter((segment) => segment.length >= 8);

  if (stableSegments.length < 2) {
    return false;
  }

  const matchedSegments = stableSegments.filter((segment) =>
    searchableContent.includes(segment)
  ).length;

  return matchedSegments >= Math.min(2, stableSegments.length);
}

function readReviewAnchorPayloadString(thread: CommentThreadData, keys: string[]) {
  for (const key of keys) {
    const value = thread.reviewAnchor?.anchorPayload?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function buildSearchableContent(content: string) {
  const rawText = normalizeSearchText(content);
  const extractedText: string[] = [];

  try {
    collectJsonText(JSON.parse(content), extractedText);
  } catch {
    return rawText;
  }

  const jsonText = normalizeSearchText(extractedText.join(' '));
  if (!jsonText) {
    return rawText;
  }

  if (!rawText) {
    return jsonText;
  }

  return `${rawText}\n${jsonText}`;
}

function collectJsonText(value: unknown, target: string[]) {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectJsonText(entry, target));
    return;
  }

  Object.entries(value).forEach(([key, entry]) => {
    if (key === 'text' && typeof entry === 'string' && entry.trim()) {
      target.push(entry);
      return;
    }

    if (entry && typeof entry === 'object') {
      collectJsonText(entry, target);
    }
  });
}

function normalizeSearchText(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function isWebComponentThread(thread: CommentThreadData) {
  return thread.reviewAnchor?.surfaceType === 'web-component';
}
