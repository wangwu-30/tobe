import { resolveWorkspaceProjectTitle } from '@/objects/project/queries';
import type { ProjectMountData } from '@/types';

type ProjectMountProjectSeed = {
  id: string;
  projectTitle: string | null;
  title: string;
} | null;

export type ProjectMountSeed = {
  createdAt: Date;
  id: string;
  organizationId: string;
  sourceProject: ProjectMountProjectSeed;
  sourceProjectId: string;
  targetProject: ProjectMountProjectSeed;
  targetProjectId: string;
};

export function mapProjectMount(mount: ProjectMountSeed): ProjectMountData {
  return {
    createdAt: mount.createdAt,
    id: mount.id,
    organizationId: mount.organizationId,
    sourceProjectId: mount.sourceProjectId,
    sourceProjectTitle: mount.sourceProject
      ? resolveWorkspaceProjectTitle(mount.sourceProject)
      : null,
    targetProjectId: mount.targetProjectId,
    targetProjectTitle: mount.targetProject
      ? resolveWorkspaceProjectTitle(mount.targetProject)
      : null,
  };
}
