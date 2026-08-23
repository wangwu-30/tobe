type ThreadRevisionQueryParams = {
  currentDraftRevision: number | null;
  draftOnly: boolean;
  inheritedVersionIds: string[];
  versionId: string | null;
};

type InheritedThreadCandidate = {
  createdAt: Date;
  draftRevision: number | null;
  id: string;
  updatedAt: Date;
  versionId: string | null;
};

type VersionLineageNode = {
  id: string;
  parentVersionId: string | null;
};

type InheritedThreadResponseSource = {
  version: { title: string } | null;
  versionId: string | null;
};

const ACTIVE_THREAD_STATUSES = ['open', 'applied'];

export function buildCommentVersionLineageFilter(params: {
  organizationId: string;
  workspaceId: string;
}) {
  return {
    deletedAt: null,
    documentId: params.workspaceId,
    organizationId: params.organizationId,
  };
}

export function buildCommentThreadRevisionFilters(
  params: ThreadRevisionQueryParams
) {
  const direct = params.versionId
    ? { versionId: params.versionId }
    : params.draftOnly
      ? { versionId: null, draftRevision: params.currentDraftRevision }
      : {};
  const priorDraft =
    params.draftOnly &&
    params.versionId === null &&
    typeof params.currentDraftRevision === 'number'
      ? {
          versionId: null,
          draftRevision: { lt: params.currentDraftRevision },
          status: { in: [...ACTIVE_THREAD_STATUSES] },
        }
      : null;
  const inheritedVersion =
    params.inheritedVersionIds.length > 0
      ? {
          versionId: { in: [...params.inheritedVersionIds] },
          status: { in: [...ACTIVE_THREAD_STATUSES] },
        }
      : null;

  return { direct, inheritedVersion, priorDraft };
}

export function orderInheritedCommentThreadCandidates<
  T extends InheritedThreadCandidate,
>(params: {
  inheritedVersionIds: string[];
  priorDraftThreads: T[];
  versionThreads: T[];
}) {
  const versionRank = new Map(
    params.inheritedVersionIds.map((id, index) => [id, index])
  );
  const priorDraftThreads = [...params.priorDraftThreads].sort((left, right) => {
    const revisionDelta =
      (right.draftRevision ?? Number.MIN_SAFE_INTEGER) -
      (left.draftRevision ?? Number.MIN_SAFE_INTEGER);
    return revisionDelta || compareNewestFirst(left, right);
  });
  const versionThreads = [...params.versionThreads].sort((left, right) => {
    const rankDelta =
      (versionRank.get(left.versionId || '') ?? Number.MAX_SAFE_INTEGER) -
      (versionRank.get(right.versionId || '') ?? Number.MAX_SAFE_INTEGER);
    return rankDelta || compareNewestFirst(left, right);
  });

  return [...priorDraftThreads, ...versionThreads];
}

export function markCommentThreadInherited<T extends InheritedThreadResponseSource>(
  thread: T,
  inheritanceState: 'actionable' | 'stale' | 'superseded'
) {
  return {
    ...thread,
    sourceVersionId: thread.versionId,
    scope: 'inherited' as const,
    inheritanceState,
    inheritedFromVersionId: thread.versionId,
    inheritedFromVersionTitle: thread.version?.title || null,
    isInherited: true,
  };
}

export function resolveCommentVersionLineageIds(params: {
  startVersionId: string;
  versions: VersionLineageNode[];
}) {
  const versionsById = new Map(params.versions.map((version) => [version.id, version]));
  const visited = new Set<string>();
  const lineageIds: string[] = [];
  let currentVersionId: string | null = params.startVersionId;

  while (currentVersionId) {
    if (visited.has(currentVersionId)) {
      return [];
    }
    visited.add(currentVersionId);

    const current = versionsById.get(currentVersionId);
    if (!current) {
      return [];
    }
    lineageIds.push(current.id);
    if (!current.parentVersionId) {
      return lineageIds;
    }

    currentVersionId = current.parentVersionId;
  }

  return lineageIds;
}

function compareNewestFirst(
  left: Pick<InheritedThreadCandidate, 'createdAt' | 'id' | 'updatedAt'>,
  right: Pick<InheritedThreadCandidate, 'createdAt' | 'id' | 'updatedAt'>
) {
  const updatedDelta = right.updatedAt.getTime() - left.updatedAt.getTime();
  const createdDelta = right.createdAt.getTime() - left.createdAt.getTime();
  if (updatedDelta || createdDelta) {
    return updatedDelta || createdDelta;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}
