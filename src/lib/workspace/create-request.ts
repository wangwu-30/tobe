import type { DeliverableType } from '@/types';

export const WORKSPACE_CREATE_IDEMPOTENCY_HEADER = 'x-dao-idempotency-key';

const WORKSPACE_CREATE_RECOVERY_STORAGE_KEY = 'dao-workspace-create-recovery';

export type WorkspaceCreateRecovery = {
  requestId: string;
  values: {
    constraints: string;
    deliverableType: DeliverableType;
    goal: string;
    styleGuide: string;
  };
};

export function loadWorkspaceCreateRecovery() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(WORKSPACE_CREATE_RECOVERY_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<WorkspaceCreateRecovery> | null;
    if (
      !parsed ||
      typeof parsed.requestId !== 'string' ||
      !parsed.values ||
      typeof parsed.values.goal !== 'string' ||
      typeof parsed.values.constraints !== 'string' ||
      typeof parsed.values.styleGuide !== 'string' ||
      (parsed.values.deliverableType !== 'document' &&
        parsed.values.deliverableType !== 'slides' &&
        parsed.values.deliverableType !== 'web' &&
        parsed.values.deliverableType !== 'code')
    ) {
      return null;
    }

    return parsed as WorkspaceCreateRecovery;
  } catch {
    return null;
  }
}

export function persistWorkspaceCreateRecovery(recovery: WorkspaceCreateRecovery) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(
    WORKSPACE_CREATE_RECOVERY_STORAGE_KEY,
    JSON.stringify(recovery)
  );
}

export function clearWorkspaceCreateRecovery() {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(WORKSPACE_CREATE_RECOVERY_STORAGE_KEY);
}
