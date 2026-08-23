import type { DraftThreadBindingDb } from '@/lib/comments/version-binding';
import type { WorkspaceRunData } from '@/types';

export type WorkspaceStateActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

export type CreateWorkspaceVersionDependencies = {
  bindDraftThreadsToVersion: (
    workspaceId: string,
    versionId: string,
    draftRevision: number,
    organizationId: string,
    db: DraftThreadBindingDb
  ) => Promise<void>;
  ensureWorkspaceEditable: (
    actor: WorkspaceStateActorContext,
    workspaceId: string
  ) => Promise<void>;
  recordSyncEvent: (params: {
    actorUserId: string;
    entityId: string;
    entityType: string;
    organizationId: string;
    originDeviceId?: string | null;
    payload: unknown;
    revision: number;
  }) => Promise<void>;
};

export type ReplaceWorkspaceDraftDependencies = {
  materializeWorkspaceMirror: (params: {
    organizationId: string;
    workspaceId: string;
  }) => Promise<unknown>;
  startWorkspacePreview: (
    actor: WorkspaceStateActorContext,
    input: {
      workspaceId: string;
    }
  ) => Promise<WorkspaceRunData>;
};

export type RestoreWorkspaceVersionDependencies =
  CreateWorkspaceVersionDependencies &
    ReplaceWorkspaceDraftDependencies & {
      listWorkspaceRuns: (params: {
        organizationId: string;
        workspaceId: string;
      }) => Promise<WorkspaceRunData[]>;
    };

export type SetWorkspaceVersionPinnedDependencies = {
  ensureWorkspaceEditable: (
    actor: WorkspaceStateActorContext,
    workspaceId: string
  ) => Promise<void>;
};
