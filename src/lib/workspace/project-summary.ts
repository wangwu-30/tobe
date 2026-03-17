import type { ProjectFolderItem, ProjectSummaryData } from '@/types';

type TranslateFn = (
  key:
    | 'sidebar.latestDeliverable'
    | 'sidebar.projectDeliverableCountPlural'
    | 'sidebar.projectDeliverableCountSingular',
  variables?: Record<string, string | number>
) => string;

export function formatProjectDeliverableCount(
  count: number,
  t: TranslateFn
) {
  if (count === 1) {
    return t('sidebar.projectDeliverableCountSingular');
  }

  return t('sidebar.projectDeliverableCountPlural', {
    count,
  });
}

export function formatProjectListMeta(
  project: ProjectSummaryData,
  t: TranslateFn
) {
  const parts = [formatProjectDeliverableCount(project.deliverableCount, t)];

  if (project.latestDeliverableTitle) {
    parts.push(
      t('sidebar.latestDeliverable', {
        title: project.latestDeliverableTitle,
      })
    );
  }

  return parts.join(' · ');
}

export function listProjectFolderPath(
  projectFolderId: string | null,
  folders: ProjectFolderItem[]
) {
  if (!projectFolderId) {
    return [];
  }

  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const segments: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = projectFolderId;

  while (currentId) {
    if (visited.has(currentId)) {
      break;
    }

    visited.add(currentId);
    const folder = folderById.get(currentId);
    if (!folder) {
      break;
    }

    segments.unshift(folder.title);
    currentId = folder.parentFolderId || null;
  }

  return segments;
}
