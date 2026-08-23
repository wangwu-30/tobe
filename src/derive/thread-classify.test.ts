import { expect, test } from '@playwright/test';

import type { CommentThreadData } from '@/types';

import {
  buildCommentSurfaceText,
  classifyInheritedCommentThread,
  type CommentThreadSurfaceFile,
} from './thread-classify';

const FILE_ID = 'thread-classify-file';
const FIRST_PARAGRAPH = '第一段跨块评论。';
const SECOND_PARAGRAPH = '第二段仍是同一个锚点。';

test.describe('inherited comment thread surface matching', () => {
  test('keeps a separator-free cross-block excerpt actionable across two Plate paragraphs', () => {
    const surfaceFile = buildPlateSurfaceFile([FIRST_PARAGRAPH, SECOND_PARAGRAPH]);

    expect(
      classifyThread({
        excerpt: `${FIRST_PARAGRAPH}${SECOND_PARAGRAPH}`,
        surfaceFile,
      })
    ).toBe('actionable');
  });

  test('keeps the existing normalized whitespace match', () => {
    const surfaceFile = buildPlateSurfaceFile(['保留   原有', '空白正常化。']);

    expect(
      classifyThread({
        excerpt: '保留 原有 空白正常化。',
        surfaceFile,
      })
    ).toBe('actionable');
  });

  test('does not treat non-whitespace edits as a cross-block match', () => {
    const surfaceFile = buildPlateSurfaceFile([FIRST_PARAGRAPH, SECOND_PARAGRAPH]);

    expect(
      classifyThread({
        excerpt: `${FIRST_PARAGRAPH}已修改${SECOND_PARAGRAPH}`,
        surfaceFile,
      })
    ).toBe('stale');
    expect(
      classifyThread({
        excerpt: `${SECOND_PARAGRAPH}${FIRST_PARAGRAPH}`,
        surfaceFile,
      })
    ).toBe('stale');
  });
});

function classifyThread(params: {
  excerpt: string;
  surfaceFile: CommentThreadSurfaceFile;
}) {
  return classifyInheritedCommentThread({
    combinedSurfaceText: buildCommentSurfaceText([params.surfaceFile]),
    directFingerprints: new Set(),
    directIdentityCandidates: new Set(),
    seenInheritedFingerprints: new Set(),
    seenInheritedIdentityCandidates: new Set(),
    surfaceFilesById: new Map([[FILE_ID, params.surfaceFile]]),
    thread: buildInheritedCrossBlockThread(params.excerpt),
  });
}

function buildPlateSurfaceFile(paragraphs: string[]): CommentThreadSurfaceFile {
  return {
    content: JSON.stringify(
      paragraphs.map((text) => ({
        children: [{ text }],
        type: 'p',
      }))
    ),
    id: FILE_ID,
    path: 'document.json',
  };
}

function buildInheritedCrossBlockThread(excerpt: string): CommentThreadData {
  const timestamp = '2026-08-23T00:00:00.000Z';
  return {
    agentBindings: [],
    anchorFingerprint: `cross-block:${excerpt}`,
    anchorText: excerpt,
    createdAt: timestamp,
    createdByUserId: 'thread-author',
    deletedAt: null,
    draftRevision: 1,
    fileId: FILE_ID,
    id: 'inherited-cross-block-thread',
    inheritanceState: null,
    inheritedFromVersionId: 'source-version',
    inheritedFromVersionTitle: 'Source version',
    isInherited: true,
    messages: [],
    organizationId: 'thread-classify-org',
    originDeviceId: 'thread-device',
    researchState: null,
    resolvedAt: null,
    reviewAnchor: {
      anchorPayload: {
        excerpt,
        rangeState: 'cross-block',
      },
      bindingType: 'selection',
      sourceMapping: { fileId: FILE_ID },
      surfaceType: 'document-selection',
    },
    revision: 1,
    scope: 'inherited',
    selectionAnchor: null,
    sourceVersionId: 'source-version',
    status: 'open',
    updatedAt: timestamp,
    version: null,
    versionId: 'source-version',
    workspaceId: 'thread-classify-workspace',
  };
}
