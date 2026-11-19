import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import type { NoteData } from '@/types';
import {
  STUDIO_CONTEXT_BUDGET_V1,
  selectBoundedNoteLines,
  truncateBoundedText,
} from './context-budget';

function makeNote(
  overrides: Partial<NoteData> & { id: string; scope: NoteData['scope']; scopeId: string }
): NoteData {
  return {
    active: true,
    content: `Content for ${overrides.id}`,
    createdAt: '2026-08-22T00:00:00.000Z',
    createdByUserId: 'user-test',
    deletedAt: null,
    kind: 'knowledge',
    organizationId: 'org-test',
    originDeviceId: 'device-test',
    revision: 1,
    source: 'manual',
    sourceRef: null,
    title: `Title ${overrides.id}`,
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('Studio AI context budgeting', () => {
  test('prioritizes deliverable > project > user notes and emits explicit omission notice when capped', () => {
    const notes: NoteData[] = [
      makeNote({ id: 'user-1', scope: 'user', scopeId: 'u-1', content: 'User preference A' }),
      makeNote({ id: 'project-1', scope: 'project', scopeId: 'p-1', content: 'Project rule B' }),
      makeNote({ id: 'current-1', scope: 'deliverable', scopeId: 'w-1', content: 'Deliverable rule C' }),
      makeNote({ id: 'user-2', scope: 'user', scopeId: 'u-1', content: 'User preference D' }),
    ];

    const selected = selectBoundedNoteLines({
      formatLine: (note) => `- [${note.scope}] ${note.content}`,
      label: 'memories',
      maxChars: 1_000,
      maxItems: 2,
      notes,
      projectId: 'p-1',
      workspaceId: 'w-1',
    });

    assert.equal(selected.includedCount, 2);
    assert.equal(selected.omittedCount, 2);
    assert.deepEqual(selected.lines, [
      '- [deliverable] Deliverable rule C',
      '- [project] Project rule B',
    ]);
    assert.ok(selected.omissionNotice?.includes('2 additional active memories omitted'));
  });

  test('enforces character ceiling and cleanly truncates oversized note entries', () => {
    const notes: NoteData[] = [
      makeNote({
        id: 'large-1',
        scope: 'deliverable',
        scopeId: 'w-1',
        content: 'A'.repeat(400),
      }),
      makeNote({
        id: 'next-2',
        scope: 'project',
        scopeId: 'p-1',
        content: 'Should be omitted after budget exhausted',
      }),
    ];

    const selected = selectBoundedNoteLines({
      formatLine: (note) => `- ${note.content}`,
      label: 'knowledge notes',
      maxChars: 120,
      maxItems: 10,
      notes,
      projectId: 'p-1',
      workspaceId: 'w-1',
    });

    assert.equal(selected.includedCount, 1);
    assert.equal(selected.truncatedCount, 1);
    assert.equal(selected.omittedCount, 1);
    assert.ok(selected.usedChars <= 120);
    assert.ok(selected.lines[0]?.includes('[...truncated]'));
    assert.ok(selected.omissionNotice?.includes('1 additional active knowledge notes omitted'));
  });

  test('preserves anchor text window when truncating long wiki content', () => {
    const prefix = 'Prefix paragraph. '.repeat(200);
    const anchor = 'CRITICAL_LAUNCH_METRIC_42_CREDITS';
    const suffix = 'Suffix paragraph. '.repeat(200);
    const fullContent = `${prefix}${anchor}${suffix}`;

    const bounded = truncateBoundedText(fullContent, 600, { anchorText: anchor });

    assert.equal(bounded.truncated, true);
    assert.equal(bounded.originalLength, fullContent.length);
    assert.ok(bounded.content.includes(anchor));
    assert.ok(bounded.content.includes('[...earlier content omitted]'));
    assert.ok(bounded.content.includes('[...later content omitted]'));
    assert.ok(bounded.content.length <= 620);
  });

  test('exposes explicit positive caps for chat, comment, and suggestion surfaces', () => {
    assert.ok(STUDIO_CONTEXT_BUDGET_V1.noteQueryTakeLimit >= 32);
    assert.ok(STUDIO_CONTEXT_BUDGET_V1.chat.maxMemoriesChars > 0);
    assert.ok(STUDIO_CONTEXT_BUDGET_V1.chat.maxKnowledgeNotesChars > 0);
    assert.ok(STUDIO_CONTEXT_BUDGET_V1.comment.maxWikiChars > 0);
    assert.ok(STUDIO_CONTEXT_BUDGET_V1.suggestion.maxWikiChars > 0);
  });
});
