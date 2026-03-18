'use client';

import { Badge } from '@/components/ui/badge';
import { useT } from '@/components/providers/language-provider';
import type { WorkflowExtensionHintData, WorkflowExtensionKind } from '@/types';

function getWorkflowExtensionLabel(kind: WorkflowExtensionKind, t: ReturnType<typeof useT>) {
  switch (kind) {
    case 'tools':
      return t('context.workflowExtensionTools');
    case 'mcp':
      return t('context.workflowExtensionMcp');
    case 'skills':
      return t('context.workflowExtensionSkills');
    default:
      return kind;
  }
}

export function WorkflowExtensionHints({
  detailed = false,
  hints,
  testIdPrefix,
}: {
  detailed?: boolean;
  hints: WorkflowExtensionHintData[];
  testIdPrefix?: string;
}) {
  const t = useT();

  if (hints.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {t('context.workflowExtensionsLabel')}
      </div>
      <div className="flex flex-wrap gap-2">
        {hints.map((hint) => (
          <Badge
            key={`${hint.kind}-${hint.summary}`}
            variant="outline"
            className="text-[10px]"
            data-testid={testIdPrefix ? `${testIdPrefix}-${hint.kind}` : undefined}
          >
            {getWorkflowExtensionLabel(hint.kind, t)}
          </Badge>
        ))}
      </div>
      {detailed ? (
        <div className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
          {hints.map((hint) => (
            <p key={`${hint.kind}-detail-${hint.summary}`}>
              <span className="font-medium text-foreground/80">
                {getWorkflowExtensionLabel(hint.kind, t)}
              </span>
              {': '}
              {hint.summary}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
