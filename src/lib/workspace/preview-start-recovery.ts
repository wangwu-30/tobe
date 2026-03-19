const PREVIEW_START_RECOVERY_STORAGE_KEY = 'dao-preview-start-recovery';
const PREVIEW_START_RECOVERY_MAX_AGE_MS = 30_000;

type PreviewStartRecovery = {
  requestedAt: number;
  versionId: string | null;
  workspaceId: string;
};

export function loadPendingPreviewStart(workspaceId: string) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PREVIEW_START_RECOVERY_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PreviewStartRecovery> | null;
    if (
      !parsed ||
      parsed.workspaceId !== workspaceId ||
      typeof parsed.requestedAt !== 'number' ||
      (parsed.versionId !== null &&
        parsed.versionId !== undefined &&
        typeof parsed.versionId !== 'string')
    ) {
      clearPendingPreviewStart(workspaceId);
      return null;
    }

    if (Date.now() - parsed.requestedAt > PREVIEW_START_RECOVERY_MAX_AGE_MS) {
      clearPendingPreviewStart(workspaceId);
      return null;
    }

    return {
      requestedAt: parsed.requestedAt,
      versionId: typeof parsed.versionId === 'string' ? parsed.versionId : null,
      workspaceId: parsed.workspaceId,
    } satisfies PreviewStartRecovery;
  } catch {
    clearPendingPreviewStart(workspaceId);
    return null;
  }
}

export function persistPendingPreviewStart(input: {
  versionId: string | null;
  workspaceId: string;
}) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(
    PREVIEW_START_RECOVERY_STORAGE_KEY,
    JSON.stringify({
      requestedAt: Date.now(),
      versionId: input.versionId,
      workspaceId: input.workspaceId,
    } satisfies PreviewStartRecovery)
  );
}

export function clearPendingPreviewStart(workspaceId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const raw = window.sessionStorage.getItem(PREVIEW_START_RECOVERY_STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as Partial<PreviewStartRecovery> | null;
    if (!parsed || parsed.workspaceId === workspaceId) {
      window.sessionStorage.removeItem(PREVIEW_START_RECOVERY_STORAGE_KEY);
    }
  } catch {
    window.sessionStorage.removeItem(PREVIEW_START_RECOVERY_STORAGE_KEY);
  }
}
