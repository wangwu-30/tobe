import { safeJsonParse } from '@/framework/resilience';

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

  const parsed = readPreviewStartRecoveryRecord();
  if (
    !parsed ||
    parsed.workspaceId !== workspaceId ||
    Date.now() - parsed.requestedAt > PREVIEW_START_RECOVERY_MAX_AGE_MS
  ) {
    clearPendingPreviewStart(workspaceId);
    return null;
  }

  return parsed;
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

  const parsed = readPreviewStartRecoveryRecord();
  if (!parsed || parsed.workspaceId === workspaceId) {
    window.sessionStorage.removeItem(PREVIEW_START_RECOVERY_STORAGE_KEY);
  }
}

function readPreviewStartRecoveryRecord(): PreviewStartRecovery | null {
  const raw = window.sessionStorage.getItem(PREVIEW_START_RECOVERY_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  const parsed = safeJsonParse<Partial<PreviewStartRecovery> | null>(raw, null);
  if (
    !parsed ||
    typeof parsed.workspaceId !== 'string' ||
    typeof parsed.requestedAt !== 'number' ||
    (parsed.versionId !== null &&
      parsed.versionId !== undefined &&
      typeof parsed.versionId !== 'string')
  ) {
    return null;
  }

  return {
    requestedAt: parsed.requestedAt,
    versionId: typeof parsed.versionId === 'string' ? parsed.versionId : null,
    workspaceId: parsed.workspaceId,
  };
}
