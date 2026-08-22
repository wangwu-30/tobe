import type {
  StateLabelData,
  WorkspaceVersionData,
} from '@/types';

type StateLabelLike = {
  kind: string | null | undefined;
};

type WorkspaceStateSemanticsSource = {
  labels?: StateLabelLike[] | null;
};

type WorkspaceStateSemantics = Pick<
  WorkspaceVersionData,
  | 'aligned'
  | 'pinned'
  | 'recoveryKind'
  | 'restorable'
  | 'versionType'
  | 'visible'
>;

export function hasStateLabelKind(
  labels: StateLabelLike[] | null | undefined,
  kind: StateLabelData['kind']
) {
  return (labels || []).some((label) => label.kind === kind);
}

export function hasVisibleStateLabel(labels?: StateLabelLike[] | null) {
  return hasStateLabelKind(labels, 'milestone') || hasStateLabelKind(labels, 'head');
}

export function hasRecoveryStateLabel(labels?: StateLabelLike[] | null) {
  return hasStateLabelKind(labels, 'recovery');
}

export function hasPinnedStateLabel(labels?: StateLabelLike[] | null) {
  return hasStateLabelKind(labels, 'pinned');
}

export function hasAlignedStateLabel(labels?: StateLabelLike[] | null) {
  return hasStateLabelKind(labels, 'aligned');
}

export function deriveWorkspaceStateSemantics(
  source: WorkspaceStateSemanticsSource
): WorkspaceStateSemantics {
  const visible = hasVisibleStateLabel(source.labels);
  const pinned = hasPinnedStateLabel(source.labels);
  const versionType = visible ? 'manual' : pinned ? 'checkpoint_pinned' : 'checkpoint';

  return {
    // Alignment is effective only for a visible immutable state. This keeps
    // malformed legacy recovery points fail-closed even if they carry an
    // orphaned aligned label.
    aligned: visible && hasAlignedStateLabel(source.labels),
    versionType,
    visible,
    restorable: true,
    pinned,
    recoveryKind: visible ? null : pinned ? 'pinned' : 'temporary',
  };
}

export function isVisibleWorkspaceState(source: WorkspaceStateSemanticsSource) {
  return deriveWorkspaceStateSemantics(source).visible;
}

export function isRecoveryWorkspaceState(source: WorkspaceStateSemanticsSource) {
  return !deriveWorkspaceStateSemantics(source).visible;
}
