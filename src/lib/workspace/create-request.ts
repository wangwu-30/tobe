import type { DeliverableType } from '@/types';
import {
  mapDeliverableTypeToCreateIntent,
  normalizeWorkspaceCreateIntent,
  normalizeWorkspaceCreateIntentChoice,
  type WorkspaceCreateIntent,
  type WorkspaceCreateIntentChoice,
} from '@/lib/workspace/create-intent';
import { normalizeStoredDeliverableType } from '@/lib/workspace/deliverable-types';
import {
  buildWorkspaceRoute,
  type WorkspaceAssistantTab,
} from '@/lib/workspace/route';
import { apiCall, safeJsonParse } from '@/framework/resilience';


export const WORKSPACE_CREATE_IDEMPOTENCY_HEADER = 'x-dao-idempotency-key';

const WORKSPACE_CREATE_RECOVERY_STORAGE_KEY = 'dao-workspace-create-recovery';

export type WorkspaceCreateContext = {
  conversationId: string | null;
  projectFolderId: string | null;
  projectId: string | null;
  projectTitle: string | null;
};

export type WorkspaceCreateValues = {
  constraints: string;
  createMode?: WorkspaceCreateIntent | null;
  deliverableType?: DeliverableType | null;
  goal: string;
  projectParentPath: string;
  selectedIntent?: WorkspaceCreateIntentChoice | null;
  selectedIntentNote?: string;
  styleGuide: string;
  title?: string;
  workflowPlaybookId: string;
};

export type WorkspaceCreateRecovery = {
  context?: Partial<WorkspaceCreateContext>;
  requestId: string;
  values: WorkspaceCreateValues;
};

export type WorkspaceCreateResult = {
  conversation: { id: string };
  initialRoomMessageReceipt: {
    messageId: string;
    roomId: string;
    status: 'accepted';
  } | null;
  room: { id: string; projectId: string | null };
  workspace: { id: string; projectId?: string | null };
};

export class WorkspaceCreateActionError extends Error {
  readonly outcome = 'unknown' as const;
}
export class WorkspaceCreateRequestError extends Error {
  constructor(
    message: string,
    readonly outcome: 'rejected' | 'unknown'
  ) {
    super(message);
    this.name = 'WorkspaceCreateRequestError';
  }
}

export function classifyWorkspaceCreateError(params: {
  code?: string | null;
  kind: 'http' | 'network' | 'parse' | 'timeout';
  message?: string | null;
  responsePresent: boolean;
  status: number | null;
}): 'rejected' | 'unknown' {
  return !params.responsePresent ||
    params.kind === 'network' ||
    params.kind === 'timeout' ||
    params.kind === 'parse' ||
    params.status === 408 ||
    params.code === 'WORKSPACE_CREATE_IN_PROGRESS' ||
    (params.status === 409 &&
      params.message?.toLowerCase().includes('still in progress')) ||
    (params.status !== null && params.status >= 500)
    ? 'unknown'
    : 'rejected';
}

export function hasUnknownWorkspaceCreateOutcome(error: unknown) {
  return !(
    (error instanceof WorkspaceCreateActionError ||
      error instanceof WorkspaceCreateRequestError) &&
    error.outcome === 'rejected'
  );
}

export function getWorkspaceCreateErrorMessage(
  error: unknown,
  fallbackMessage: string
) {
  return error instanceof Error && error.message ? error.message : fallbackMessage;
}

function buildWorkspaceCreateBody(params: {
  context?: WorkspaceCreateContext | null;
  values: WorkspaceCreateValues;
}) {
  return {
    ...params.values,
    ...(params.context
      ? {
          projectFolderId: params.context.projectFolderId,
          conversationId: params.context.conversationId,
          projectId: params.context.projectId,
          projectTitle: params.context.projectTitle,
        }
      : {}),
  };
}

export function loadWorkspaceCreateRecovery() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(WORKSPACE_CREATE_RECOVERY_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = safeJsonParse<Partial<WorkspaceCreateRecovery> | null>(raw, null);
    const createMode = normalizeWorkspaceCreateIntent(parsed?.values?.createMode);
    const deliverableType = normalizeStoredDeliverableType(parsed?.values?.deliverableType);
    const selectedIntent = normalizeWorkspaceCreateIntentChoice(
      parsed?.values?.selectedIntent
    );

    if (
      !parsed ||
      typeof parsed.requestId !== 'string' ||
      !parsed.values ||
      typeof parsed.values.goal !== 'string' ||
      typeof parsed.values.constraints !== 'string' ||
      typeof parsed.values.projectParentPath !== 'string' ||
      typeof parsed.values.styleGuide !== 'string' ||
      typeof parsed.values.workflowPlaybookId !== 'string' ||
      (parsed.values.title !== undefined &&
        typeof parsed.values.title !== 'string') ||
      (parsed.values.selectedIntentNote !== undefined &&
        typeof parsed.values.selectedIntentNote !== 'string')
    ) {
      return null;
    }

    if (
        parsed.context &&
      ((parsed.context.conversationId !== undefined &&
        parsed.context.conversationId !== null &&
        typeof parsed.context.conversationId !== 'string') ||
        (parsed.context.projectFolderId !== undefined &&
        parsed.context.projectFolderId !== null &&
        typeof parsed.context.projectFolderId !== 'string') ||
        (parsed.context.projectId !== undefined &&
          parsed.context.projectId !== null &&
          typeof parsed.context.projectId !== 'string') ||
        (parsed.context.projectTitle !== undefined &&
          parsed.context.projectTitle !== null &&
          typeof parsed.context.projectTitle !== 'string'))
    ) {
      return null;
    }

    return {
      context: parsed.context,
      requestId: parsed.requestId,
      values: {
        ...parsed.values,
        createMode: createMode || mapDeliverableTypeToCreateIntent(deliverableType),
        deliverableType,
        selectedIntent,
        selectedIntentNote:
          typeof parsed.values.selectedIntentNote === 'string'
            ? parsed.values.selectedIntentNote
            : '',
      },
    } satisfies WorkspaceCreateRecovery;
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

export function buildWorkspaceCreateRecovery(params: {
  context?: WorkspaceCreateContext | null;
  requestId: string;
  values: WorkspaceCreateValues;
}) {
  return {
    context: params.context
      ? {
          projectFolderId: params.context.projectFolderId,
          conversationId: params.context.conversationId,
          projectId: params.context.projectId,
          projectTitle: params.context.projectTitle,
        }
      : undefined,
    requestId: params.requestId,
    values: params.values,
  } satisfies WorkspaceCreateRecovery;
}

export function buildCreatedWorkspaceLocation(params: {
  assistant?: WorkspaceAssistantTab | null;
  autoStartFirstPass?: boolean;
  conversationId: string;
  projectId?: string | null;
  workspaceId: string;
}) {
  return buildWorkspaceRoute({
    assistant: params.assistant,
    autoStartFirstPass: params.autoStartFirstPass,
    conversationId: params.conversationId,
    nodeId: params.workspaceId,
    projectId: params.projectId || params.workspaceId,
  });
}

export async function submitWorkspaceCreateRequest(params: {
  context?: WorkspaceCreateContext | null;
  errorMessage: string;
  headers?: Record<string, string>;
  requestId: string;
  values: WorkspaceCreateValues;
}) {
  const result = await apiCall<WorkspaceCreateResult & { error?: string }>(
    '/api/workspaces',
    {
      body: JSON.stringify(
        buildWorkspaceCreateBody({
          context: params.context,
          values: params.values,
        })
      ),
      headers: {
        'Content-Type': 'application/json',
        [WORKSPACE_CREATE_IDEMPOTENCY_HEADER]: params.requestId,
        ...(params.headers || {}),
      },
      method: 'POST',
    }
  );

  if (!result.ok) {
    throw new WorkspaceCreateRequestError(
      result.error.message || params.errorMessage,
      classifyWorkspaceCreateError({
        code: result.error.code,
        kind: result.error.kind,
        message: result.error.message,
        responsePresent: result.response !== null,
        status: result.error.status,
      })
    );
  }
  const payload = result.data;

  if (
    !payload?.workspace?.id ||
    !payload?.conversation?.id ||
    !payload?.room?.id ||
    (params.values.goal.trim() &&
      payload.initialRoomMessageReceipt?.status !== 'accepted')
  ) {
    throw new WorkspaceCreateActionError(params.errorMessage);
  }

  return payload;
}
