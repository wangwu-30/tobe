import { plateToMarkdown } from '@/lib/ai/serializer';
import { safeJsonParse } from '@/framework/resilience';

import type { useT } from '@/components/providers/language-provider';
import type { DeliverableVersionData, WorkspaceVersionData } from '@/types';

export type VersionTranslateFn = ReturnType<typeof useT>;

export type DiffRow = {
  left: string;
  right: string;
  type: 'equal' | 'add' | 'remove' | 'change';
};

export type VisibleVersionTreeNode = {
  branchHead: boolean;
  depth: number;
  version: DeliverableVersionData;
  visibleParentId: string | null;
};

export type VisibleVersionBranch = {
  head: DeliverableVersionData;
  path: DeliverableVersionData[];
};

export type BranchWorkspaceSection = {
  node: VisibleVersionTreeNode;
  recoveryPoints: WorkspaceVersionData[];
};

export type VisibleBranchWorkspace = {
  pinnedRecoveryCount: number;
  recoveryCount: number;
  sections: BranchWorkspaceSection[];
  temporaryRecoveryCount: number;
};

export function getVersionPreviewText(version: DeliverableVersionData) {
  const primary = version.files.find((file) => file.isPrimary) || version.files[0];
  return normalizePreviewText(primary?.content || version.content);
}

export function normalizePreviewText(content: string) {
  const parsed = safeJsonParse<unknown>(content, null);
  if (Array.isArray(parsed)) {
    return plateToMarkdown(parsed);
  }

  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { files?: unknown }).files)) {
    const files = (parsed as { files: Array<{ content?: string; isPrimary?: boolean }> }).files;
    const primary = files.find((file) => file.isPrimary) || files[0];
    if (primary?.content) {
      return normalizePreviewText(primary.content);
    }
  }

  return content;
}

export function formatVersionOptionLabel(
  version: DeliverableVersionData,
  t: VersionTranslateFn
) {
  const prefix = version.visible ? t('version.milestone') : t('version.recoveryPoint');
  return `${prefix} · ${version.title}`;
}

export function formatVersionTime(
  value: Date | string,
  t: VersionTranslateFn
) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  });

  return t('version.restoredAt', {
    time: formatter.format(new Date(value)),
  });
}

export function isCompareSelectionAllowed(params: {
  allowDraft: boolean;
  selectableVersions: DeliverableVersionData[];
  value: string;
}) {
  if (params.value === 'draft') {
    return params.allowDraft;
  }

  return params.selectableVersions.some((version) => version.id === params.value);
}

export function getFirstCompareSelection(params: {
  allowDraft: boolean;
  selectableVersions: DeliverableVersionData[];
}) {
  if (params.selectableVersions[0]) {
    return params.selectableVersions[0].id;
  }

  return params.allowDraft ? 'draft' : '';
}

export function resolveDefaultCompareAnchor(params: {
  allowDraft: boolean;
  branch: VisibleVersionBranch | null;
  currentDraftBaseVersionId: string | null;
  selectableVersions: DeliverableVersionData[];
  selectedVersionId: string;
}) {
  if (params.selectedVersionId === 'draft') {
    if (
      params.currentDraftBaseVersionId &&
      params.selectableVersions.some((version) => version.id === params.currentDraftBaseVersionId)
    ) {
      return params.currentDraftBaseVersionId;
    }

    return params.selectableVersions[0]?.id || 'draft';
  }

  if (params.branch) {
    if (params.allowDraft && params.currentDraftBaseVersionId === params.selectedVersionId) {
      return 'draft';
    }

    const selectedIndex = params.branch.path.findIndex(
      (version) => version.id === params.selectedVersionId
    );
    if (selectedIndex > 0) {
      const parentVersionId = params.branch.path[selectedIndex - 1]?.id;
      if (
        parentVersionId &&
        params.selectableVersions.some((version) => version.id === parentVersionId)
      ) {
        return parentVersionId;
      }
    }
  }

  if (
    params.currentDraftBaseVersionId &&
    params.currentDraftBaseVersionId !== params.selectedVersionId &&
    params.selectableVersions.some((version) => version.id === params.currentDraftBaseVersionId)
  ) {
    return params.currentDraftBaseVersionId;
  }

  const fallback = params.selectableVersions.find(
    (version) => version.id !== params.selectedVersionId
  );
  if (fallback) {
    return fallback.id;
  }

  if (params.allowDraft) {
    return 'draft';
  }

  return params.selectedVersionId;
}

export function buildVisibleVersionTree(params: {
  currentDraftBaseVersionId: string | null;
  versionsById: Map<string, WorkspaceVersionData>;
  visibleVersions: DeliverableVersionData[];
}): VisibleVersionTreeNode[] {
  const visibleIds = new Set(params.visibleVersions.map((version) => version.id));
  const visibleParentById = new Map<string, string | null>();
  const childrenByParent = new Map<string | null, DeliverableVersionData[]>();

  for (const version of params.visibleVersions) {
    const visibleParentId = findNearestVisibleAncestorId(
      version.parentVersionId,
      params.versionsById,
      visibleIds
    );
    visibleParentById.set(version.id, visibleParentId);
    const siblings = childrenByParent.get(visibleParentId) || [];
    siblings.push(version);
    childrenByParent.set(visibleParentId, siblings);
  }

  const subtreeHasCurrent = new Map<string, boolean>();
  const visitCurrentSubtree = (versionId: string): boolean => {
    const cached = subtreeHasCurrent.get(versionId);
    if (cached !== undefined) {
      return cached;
    }

    const children = childrenByParent.get(versionId) || [];
    const result =
      versionId === params.currentDraftBaseVersionId ||
      children.some((child) => visitCurrentSubtree(child.id));
    subtreeHasCurrent.set(versionId, result);
    return result;
  };

  const sortSiblings = (left: DeliverableVersionData, right: DeliverableVersionData) => {
    const leftContainsCurrent = visitCurrentSubtree(left.id);
    const rightContainsCurrent = visitCurrentSubtree(right.id);
    if (leftContainsCurrent !== rightContainsCurrent) {
      return leftContainsCurrent ? -1 : 1;
    }
    return left.versionNum - right.versionNum;
  };

  for (const children of childrenByParent.values()) {
    children.sort(sortSiblings);
  }

  const ordered: VisibleVersionTreeNode[] = [];
  const roots = [...(childrenByParent.get(null) || [])].sort(sortSiblings);
  const walk = (version: DeliverableVersionData, depth: number) => {
    const children = childrenByParent.get(version.id) || [];
    ordered.push({
      branchHead:
        children.length === 0 && params.currentDraftBaseVersionId !== version.id,
      depth,
      version,
      visibleParentId: visibleParentById.get(version.id) || null,
    });
    for (const child of children) {
      walk(child, depth + 1);
    }
  };

  for (const root of roots) {
    walk(root, 0);
  }

  return ordered;
}

export function mergeWorkspaceVersions(
  current: WorkspaceVersionData[],
  incoming: DeliverableVersionData[]
): WorkspaceVersionData[] {
  if (current.length === 0) {
    return incoming;
  }

  const mergedById = new Map(current.map((version) => [version.id, version]));
  let changed = false;

  for (const version of incoming) {
    if (mergedById.get(version.id) !== version) {
      mergedById.set(version.id, version);
      changed = true;
    }
  }

  return changed ? Array.from(mergedById.values()) : current;
}

export function buildVisibleBranchOverview(params: {
  currentDraftBaseVersionId: string | null;
  nodes: VisibleVersionTreeNode[];
}): VisibleVersionBranch[] {
  const nodesById = new Map(params.nodes.map((node) => [node.version.id, node]));
  const parentIds = new Set(
    params.nodes
      .map((node) => node.visibleParentId)
      .filter((value): value is string => Boolean(value))
  );
  const branches = params.nodes
    .filter((node) => !parentIds.has(node.version.id))
    .map((node) => {
      const path: DeliverableVersionData[] = [];
      let currentNode: VisibleVersionTreeNode | undefined = node;

      while (currentNode) {
        path.unshift(currentNode.version);
        currentNode = currentNode.visibleParentId
          ? nodesById.get(currentNode.visibleParentId)
          : undefined;
      }

      return {
        head: node.version,
        path,
      };
    });

  branches.sort((left, right) => {
    const leftIsCurrent = left.head.id === params.currentDraftBaseVersionId;
    const rightIsCurrent = right.head.id === params.currentDraftBaseVersionId;
    if (leftIsCurrent !== rightIsCurrent) {
      return leftIsCurrent ? -1 : 1;
    }
    return left.head.versionNum - right.head.versionNum;
  });

  return branches;
}

export function buildVisibleBranchWorkspace(params: {
  branch: VisibleVersionBranch;
  nodes: VisibleVersionTreeNode[];
  recoveryPoints: WorkspaceVersionData[];
  versionsById: Map<string, WorkspaceVersionData>;
  visibleIds: Set<string>;
}): VisibleBranchWorkspace {
  const branchIds = new Set(params.branch.path.map((version) => version.id));
  const sections: BranchWorkspaceSection[] = params.nodes
    .filter((node) => branchIds.has(node.version.id))
    .map((node) => ({
      node,
      recoveryPoints: [],
    }));
  const sectionsById = new Map(sections.map((section) => [section.node.version.id, section]));

  let pinnedRecoveryCount = 0;
  let temporaryRecoveryCount = 0;

  for (const version of params.recoveryPoints) {
    const branchAnchorId = findNearestVisibleAncestorId(
      version.parentVersionId,
      params.versionsById,
      params.visibleIds
    );
    if (!branchAnchorId || !branchIds.has(branchAnchorId)) {
      continue;
    }

    const section = sectionsById.get(branchAnchorId);
    if (!section) {
      continue;
    }

    section.recoveryPoints.push(version);
    if (version.pinned) {
      pinnedRecoveryCount += 1;
    } else {
      temporaryRecoveryCount += 1;
    }
  }

  for (const section of sections) {
    section.recoveryPoints.sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1;
      }
      return right.versionNum - left.versionNum;
    });
  }

  return {
    pinnedRecoveryCount,
    recoveryCount: pinnedRecoveryCount + temporaryRecoveryCount,
    sections,
    temporaryRecoveryCount,
  };
}

export function findNearestVisibleAncestorId(
  parentVersionId: string | null,
  versionsById: Map<string, WorkspaceVersionData>,
  visibleIds: Set<string>
) {
  let currentId = parentVersionId;
  while (currentId) {
    const current = versionsById.get(currentId);
    if (!current) {
      return null;
    }
    if (visibleIds.has(current.id)) {
      return current.id;
    }
    currentId = current.parentVersionId;
  }
  return null;
}

export function buildDiffRows(leftText: string, rightText: string): DiffRow[] | null {
  const left = leftText.split('\n');
  const right = rightText.split('\n');

  if (left.length * right.length > 160000) {
    return null;
  }

  const lcs = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0)
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      if (left[i] === right[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  const operations: Array<{ left: string; right: string; type: 'equal' | 'add' | 'remove' }> = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      operations.push({ left: left[i], right: right[j], type: 'equal' });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      operations.push({ left: left[i], right: '', type: 'remove' });
      i += 1;
    } else {
      operations.push({ left: '', right: right[j], type: 'add' });
      j += 1;
    }
  }

  while (i < left.length) {
    operations.push({ left: left[i], right: '', type: 'remove' });
    i += 1;
  }

  while (j < right.length) {
    operations.push({ left: '', right: right[j], type: 'add' });
    j += 1;
  }

  const rows: DiffRow[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    const current = operations[index];
    const next = operations[index + 1];

    if (current.type === 'remove' && next?.type === 'add') {
      rows.push({
        left: current.left,
        right: next.right,
        type: 'change',
      });
      index += 1;
      continue;
    }

    rows.push({
      left: current.left,
      right: current.right,
      type: current.type,
    });
  }

  return rows;
}
