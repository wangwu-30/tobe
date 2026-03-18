import { getBuiltinWorkflowPlaybookByOriginDeviceId } from '@/lib/workflows/builtin-playbooks';
import type { WorkflowExtensionHintData, WorkflowExtensionKind } from '@/types';

function isWorkflowExtensionKind(value: unknown): value is WorkflowExtensionKind {
  return value === 'tools' || value === 'mcp' || value === 'skills';
}

function normalizeWorkflowExtensionHint(
  value: unknown
): WorkflowExtensionHintData | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (!isWorkflowExtensionKind(record.kind)) {
    return null;
  }

  if (typeof record.summary !== 'string' || !record.summary.trim()) {
    return null;
  }

  return {
    kind: record.kind,
    summary: record.summary.trim(),
  };
}

export function normalizeWorkflowExtensionHints(
  value: unknown
): WorkflowExtensionHintData[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((item) => normalizeWorkflowExtensionHint(item))
    .filter((item): item is WorkflowExtensionHintData => Boolean(item));

  const deduped = new Set<string>();
  return normalized.filter((item) => {
    const key = `${item.kind}:${item.summary}`;
    if (deduped.has(key)) {
      return false;
    }

    deduped.add(key);
    return true;
  });
}

export function parseWorkflowExtensionHints(raw: string | null | undefined) {
  if (!raw?.trim()) {
    return [];
  }

  try {
    return normalizeWorkflowExtensionHints(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function serializeWorkflowExtensionHints(
  value: WorkflowExtensionHintData[] | null | undefined
) {
  return JSON.stringify(normalizeWorkflowExtensionHints(value));
}

export function resolveWorkflowExtensionHints(params: {
  originDeviceId?: string | null;
  serialized?: string | null;
}) {
  const persistedHints = parseWorkflowExtensionHints(params.serialized);
  if (persistedHints.length > 0) {
    return persistedHints;
  }

  return (
    getBuiltinWorkflowPlaybookByOriginDeviceId(params.originDeviceId || null)
      ?.extensionHints || []
  );
}
