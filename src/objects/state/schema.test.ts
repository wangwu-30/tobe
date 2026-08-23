import { expect, test } from '@playwright/test';

import {
  deriveWorkspaceStateSemantics,
  resolveDraftBaseVersionIdFromLineage,
} from './schema';

test('aligned is an independent human approval on a visible immutable version', () => {
  expect(
    deriveWorkspaceStateSemantics({
      labels: [{ kind: 'milestone' }, { kind: 'aligned' }],
    })
  ).toMatchObject({ aligned: true, visible: true, recoveryKind: null });
});

test('aligned alone neither exposes nor authorizes a recovery state', () => {
  expect(
    deriveWorkspaceStateSemantics({
      labels: [{ kind: 'recovery' }, { kind: 'aligned' }],
    })
  ).toMatchObject({ aligned: false, visible: false, recoveryKind: 'temporary' });
});

test('visible versions remain unaligned until a human explicitly aligns them', () => {
  expect(deriveWorkspaceStateSemantics({ labels: [{ kind: 'head' }] })).toMatchObject({
    aligned: false,
    visible: true,
  });
});

test('draft base lineage resolves the nearest visible ancestor', () => {
  expect(
    resolveDraftBaseVersionIdFromLineage({
      startVersionId: 'recovery-2',
      versions: [
        {
          id: 'visible-a',
          labels: [{ kind: 'milestone' }],
          parentVersionId: null,
        },
        {
          id: 'recovery-1',
          labels: [{ kind: 'recovery' }],
          parentVersionId: 'visible-a',
        },
        {
          id: 'recovery-2',
          labels: [{ kind: 'recovery' }],
          parentVersionId: 'recovery-1',
        },
      ],
    })
  ).toBe('visible-a');
});

test('draft base lineage fails closed on missing parents and cycles', () => {
  expect(
    resolveDraftBaseVersionIdFromLineage({
      startVersionId: 'missing-parent',
      versions: [
        {
          id: 'missing-parent',
          labels: [{ kind: 'recovery' }],
          parentVersionId: 'outside-workspace',
        },
      ],
    })
  ).toBeNull();
  expect(
    resolveDraftBaseVersionIdFromLineage({
      startVersionId: 'cycle-a',
      versions: [
        {
          id: 'cycle-a',
          labels: [{ kind: 'recovery' }],
          parentVersionId: 'cycle-b',
        },
        {
          id: 'cycle-b',
          labels: [{ kind: 'recovery' }],
          parentVersionId: 'cycle-a',
        },
      ],
    })
  ).toBeNull();
});
