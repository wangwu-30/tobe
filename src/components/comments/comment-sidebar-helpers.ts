import { markdownToPlate, plateToMarkdown } from '@/lib/ai/serializer';
import {
  extractTextFromPlateRange,
  getStructuredDocumentSelectionRange,
  isSingleBlockDocumentSelectionRange,
  type DocumentSelectionRangeData,
} from '@/lib/comments/document-selection';
import {
  getWorkspaceFileDisplayName,
  isPlateBackedWorkspaceFile,
} from '@/lib/workspace/file-presentation';
import { safeJsonParse } from '@/framework/resilience';

import type { useT } from '@/components/providers/language-provider';
import type { CommentThreadData, WorkspaceFileData } from '@/types';

export type CommentTranslateFn = ReturnType<typeof useT>;

export type SourceApplyState = {
  canApply: boolean;
  reason: string | null;
};

export type SourceApplyPlan =
  | {
      editableText: string;
      kind: 'structured';
      range: DocumentSelectionRangeData;
      targetFile: WorkspaceFileData;
    }
  | {
      editableText: string;
      kind: 'text';
      match: { end: number; start: number };
      targetFile: WorkspaceFileData;
    };

export const BLOCKED_SOURCE_APPLY_STATE: SourceApplyState = {
  canApply: false,
  reason: null,
};

export function formatCommentResearchPhase(
  phase: NonNullable<CommentThreadData['researchState']>['progress'] extends infer T
    ? T extends { phase: infer P }
      ? P
      : never
    : never,
  t: CommentTranslateFn
) {
  if (phase === 'proposal') return t('comments.researchPhaseProposal');
  if (phase === 'searching') return t('comments.researchPhaseSearching');
  if (phase === 'analyzing_gaps') return t('comments.researchPhaseAnalyzingGaps');
  if (phase === 'reporting') return t('comments.researchPhaseReporting');
  if (phase === 'blocked') return t('comments.researchPhaseBlocked');
  return t('comments.researchPhaseCompleted');
}

export function formatDurationLabel(valueMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(valueMs / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function isOpenThread(thread: CommentThreadData) {
  return thread.status === 'open';
}

export function isAppliedThread(thread: CommentThreadData) {
  return thread.status === 'applied';
}

export function isResolvedThread(thread: CommentThreadData) {
  return thread.status === 'resolved';
}

export function groupResolvedThreads(threads: CommentThreadData[]) {
  const groups = new Map<number | null, CommentThreadData[]>();

  threads.forEach((thread) => {
    const versionNum = thread.version?.versionNum ?? null;
    const existing = groups.get(versionNum) ?? [];
    existing.push(thread);
    groups.set(versionNum, existing);
  });

  return [...groups.entries()]
    .sort(([left], [right]) => compareHistoryLabels(left, right))
    .map(([versionNum, groupedThreads]) => ({
      versionNum,
      threads: groupedThreads.sort((a, b) => {
        const leftTime = new Date(b.updatedAt).getTime();
        const rightTime = new Date(a.updatedAt).getTime();
        return leftTime - rightTime;
      }),
    }));
}

export function compareHistoryLabels(left: number | null, right: number | null) {
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

export function getSourceApplyState(params: {
  allowSourceApply: boolean;
  files: WorkspaceFileData[];
  t: CommentTranslateFn;
  thread: CommentThreadData;
}): SourceApplyState {
  if (
    !params.allowSourceApply ||
    params.thread.isInherited ||
    isResolvedThread(params.thread) ||
    isAppliedThread(params.thread)
  ) {
    return BLOCKED_SOURCE_APPLY_STATE;
  }

  const plan = resolveSourceApplyPlan(params);
  if (!plan || plan.kind === 'blocked') {
    return {
      canApply: false,
      reason: plan?.reason || null,
    };
  }

  return {
    canApply: true,
    reason: null,
  };
}

export function resolveSourceApplyPlan(params: {
  files: WorkspaceFileData[];
  t: CommentTranslateFn;
  thread: CommentThreadData;
}):
  | SourceApplyPlan
  | {
      kind: 'blocked';
      reason: string | null;
    } {
  const targetFile = resolveTargetFile(params.thread, params.files);
  if (!targetFile) {
    return {
      kind: 'blocked',
      reason: params.t('comments.applyTargetMissing'),
    };
  }

  const reviewAnchor = params.thread.reviewAnchor;
  if (reviewAnchor?.surfaceType === 'web-component') {
    return {
      kind: 'blocked',
      reason: null,
    };
  }

  const rangeState =
    typeof reviewAnchor?.anchorPayload?.rangeState === 'string'
      ? reviewAnchor.anchorPayload.rangeState
      : null;
  if (
    reviewAnchor?.surfaceType === 'document-selection' &&
    rangeState === 'cross-block'
  ) {
    return {
      kind: 'blocked',
      reason: params.t('comments.applyCrossBlockUnsupported'),
    };
  }

  const editableText = getEditableText(targetFile);
  const anchorCandidates = collectAnchorCandidates(params.thread);
  const structuredRange = getStructuredDocumentSelectionRange(reviewAnchor);
  if (
    structuredRange &&
    isSingleBlockDocumentSelectionRange(structuredRange) &&
    isPlateBackedWorkspaceFile(targetFile)
  ) {
    const structuredExcerpt = extractTextFromPlateRange(targetFile.content, structuredRange);
    if (
      structuredExcerpt &&
      matchesStructuredAnchorExcerpt(structuredExcerpt, anchorCandidates)
    ) {
      return {
        editableText,
        kind: 'structured',
        range: structuredRange,
        targetFile,
      };
    }
  }

  const textMatch = resolveUniqueAnchorMatch({
    anchorCandidates,
    sourceText: editableText,
  });
  if (!textMatch) {
    return {
      kind: 'blocked',
      reason: params.t('comments.applyAnchorMissing'),
    };
  }

  if (textMatch === 'ambiguous') {
    return {
      kind: 'blocked',
      reason: params.t('comments.applyAnchorAmbiguous'),
    };
  }

  return {
    editableText,
    kind: 'text',
    match: textMatch,
    targetFile,
  };
}

export function resolveTargetFile(
  thread: CommentThreadData,
  files: WorkspaceFileData[]
): WorkspaceFileData | null {
  const mappedFileId =
    thread.fileId || thread.reviewAnchor?.sourceMapping?.fileId || null;

  if (mappedFileId) {
    return files.find((file) => file.id === mappedFileId) || null;
  }

  return files.find((file) => file.isPrimary) || files[0] || null;
}

export function serializeThreadDiscussion(thread: CommentThreadData) {
  return thread.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) =>
      `${message.role === 'assistant' ? 'AI' : 'User'}: ${message.content.trim()}`
    )
    .join('\n\n');
}

export function collectAnchorCandidates(thread: CommentThreadData) {
  const candidates = new Set<string>();
  const excerpt =
    typeof thread.reviewAnchor?.anchorPayload?.excerpt === 'string'
      ? thread.reviewAnchor.anchorPayload.excerpt
      : null;

  [thread.anchorText, excerpt].forEach((value) => {
    const trimmed = value?.trim();
    if (trimmed) {
      candidates.add(trimmed);
    }
  });

  return [...candidates];
}

export function getEditableText(file: WorkspaceFileData) {
  if (!isPlateBackedWorkspaceFile(file)) {
    return file.content;
  }

  const parsed = safeJsonParse<unknown>(file.content, null);
  return Array.isArray(parsed) ? plateToMarkdown(parsed) : file.content;
}

export function toWorkspaceFileContent(file: WorkspaceFileData, content: string) {
  if (!isPlateBackedWorkspaceFile(file)) {
    return content;
  }

  return JSON.stringify(markdownToPlate(content));
}

export function matchesStructuredAnchorExcerpt(
  excerpt: string,
  anchorCandidates: string[]
) {
  if (anchorCandidates.length === 0) {
    return true;
  }

  const normalizedExcerpt = normalizeAnchorText(excerpt);
  return anchorCandidates.some(
    (candidate) => normalizeAnchorText(candidate) === normalizedExcerpt
  );
}

export function resolveUniqueAnchorMatch(params: {
  anchorCandidates: string[];
  sourceText: string;
}) {
  const candidates = params.anchorCandidates
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  for (const candidate of candidates) {
    const exactMatch = findUniqueExactMatch(params.sourceText, candidate);
    if (exactMatch === 'ambiguous') {
      continue;
    }
    if (exactMatch) {
      return exactMatch;
    }
  }

  const normalizedMatches = new Map<string, { end: number; start: number }>();
  let sawAmbiguousCandidate = false;

  for (const candidate of candidates) {
    const normalizedMatch = findUniqueNormalizedMatch(params.sourceText, candidate);
    if (normalizedMatch === 'ambiguous') {
      sawAmbiguousCandidate = true;
      continue;
    }
    if (normalizedMatch) {
      normalizedMatches.set(
        `${normalizedMatch.start}:${normalizedMatch.end}`,
        normalizedMatch
      );
    }
  }

  if (normalizedMatches.size === 1) {
    return [...normalizedMatches.values()][0];
  }

  if (normalizedMatches.size > 1 || sawAmbiguousCandidate) {
    return 'ambiguous' as const;
  }

  return null;
}

export function findUniqueExactMatch(sourceText: string, candidate: string) {
  const firstIndex = sourceText.indexOf(candidate);
  if (firstIndex < 0) {
    return null;
  }

  const secondIndex = sourceText.indexOf(candidate, firstIndex + candidate.length);
  if (secondIndex >= 0) {
    return 'ambiguous' as const;
  }

  return {
    end: firstIndex + candidate.length,
    start: firstIndex,
  };
}

export function findUniqueNormalizedMatch(sourceText: string, candidate: string) {
  const normalizedCandidate = normalizeAnchorText(candidate);
  if (!normalizedCandidate) {
    return null;
  }

  const indexedSource = buildNormalizedSearchIndex(sourceText);
  if (!indexedSource.text) {
    return null;
  }

  const matchIndex = indexedSource.text.indexOf(normalizedCandidate);
  if (matchIndex < 0) {
    return null;
  }

  const nextMatchIndex = indexedSource.text.indexOf(
    normalizedCandidate,
    matchIndex + normalizedCandidate.length
  );
  if (nextMatchIndex >= 0) {
    return 'ambiguous' as const;
  }

  return {
    end: indexedSource.indexMap[matchIndex + normalizedCandidate.length - 1] + 1,
    start: indexedSource.indexMap[matchIndex],
  };
}

export function buildNormalizedSearchIndex(value: string) {
  let text = '';
  const indexMap: number[] = [];
  let lastWasWhitespace = true;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (/\s/.test(character)) {
      if (lastWasWhitespace || text.length === 0) {
        continue;
      }
      text += ' ';
      indexMap.push(index);
      lastWasWhitespace = true;
      continue;
    }

    text += character.toLowerCase();
    indexMap.push(index);
    lastWasWhitespace = false;
  }

  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    indexMap.pop();
  }

  return { indexMap, text };
}

export function buildManualCommentAnchor(params: {
  currentFileId?: string | null;
  files: WorkspaceFileData[];
  t: CommentTranslateFn;
}) {
  const currentFile =
    params.currentFileId
      ? params.files.find((file) => file.id === params.currentFileId) || null
      : null;

  if (!currentFile) {
    return params.t('comments.manualDefaultAnchor');
  }

  return getWorkspaceFileDisplayName(currentFile) || params.t('comments.manualDefaultAnchor');
}

export function normalizeAnchorText(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function replaceSourceRange(
  sourceText: string,
  range: { end: number; start: number },
  replacement: string
) {
  return sourceText.slice(0, range.start) + replacement + sourceText.slice(range.end);
}
