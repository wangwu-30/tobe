import { expect, test } from '@playwright/test';

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

test.describe('Studio AI context budgeting', () => {
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

    expect(selected.includedCount).toBe(2);
    expect(selected.omittedCount).toBe(2);
    expect(selected.lines).toEqual([
      '- [deliverable] Deliverable rule C',
      '- [project] Project rule B',
    ]);
    expect(selected.omissionNotice).toContain('2 additional active memories omitted');
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

    expect(selected.includedCount).toBe(1);
    expect(selected.truncatedCount).toBe(1);
    expect(selected.omittedCount).toBe(1);
    expect(selected.usedChars).toBeLessThanOrEqual(120);
    expect(selected.lines[0]).toContain('[...truncated]');
    expect(selected.omissionNotice).toContain('1 additional active knowledge notes omitted');
  });

  test('preserves anchor text window when truncating long wiki content', () => {
    const prefix = 'Prefix paragraph. '.repeat(200);
    const anchor = 'CRITICAL_LAUNCH_METRIC_42_CREDITS';
    const suffix = 'Suffix paragraph. '.repeat(200);
    const fullContent = `${prefix}${anchor}${suffix}`;

    const bounded = truncateBoundedText(fullContent, 600, { anchorText: anchor });

    expect(bounded.truncated).toBe(true);
    expect(bounded.originalLength).toBe(fullContent.length);
    expect(bounded.content).toContain(anchor);
    expect(bounded.content).toContain('[...earlier content omitted]');
    expect(bounded.content).toContain('[...later content omitted]');
    expect(bounded.content.length).toBeLessThanOrEqual(620);
  });

  test('exposes explicit positive caps for chat, comment, and suggestion surfaces', () => {
    expect(STUDIO_CONTEXT_BUDGET_V1.noteQueryTakeLimit).toBeGreaterThanOrEqual(32);
    expect(STUDIO_CONTEXT_BUDGET_V1.chat.maxMemoriesChars).toBeGreaterThan(0);
    expect(STUDIO_CONTEXT_BUDGET_V1.chat.maxKnowledgeNotesChars).toBeGreaterThan(0);
    expect(STUDIO_CONTEXT_BUDGET_V1.comment.maxWikiChars).toBeGreaterThan(0);
    expect(STUDIO_CONTEXT_BUDGET_V1.suggestion.maxWikiChars).toBeGreaterThan(0);
  });
});
