import { expect, test } from '@playwright/test';

import { deriveWorkspaceStateSemantics } from './schema';

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
