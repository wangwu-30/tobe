import type { RenderAs } from '@/types';

export type CommentCapability = 'document-selection' | 'manual' | 'web-selection';

export function resolveCommentCapability(params: {
  previewRunning: boolean;
  renderAs: RenderAs;
  workflowPhase: string | null | undefined;
}): CommentCapability {
  if (params.workflowPhase === 'planning' || params.workflowPhase === 'implementing') {
    return 'manual';
  }

  if (params.renderAs === 'web') {
    return params.previewRunning ? 'web-selection' : 'manual';
  }

  if (params.renderAs === 'document') {
    return 'document-selection';
  }

  return 'manual';
}
