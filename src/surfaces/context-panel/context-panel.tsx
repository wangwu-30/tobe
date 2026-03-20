'use client';

import * as React from 'react';

import { KnowledgePanel } from '@/components/knowledge/knowledge-panel';

type WorkspaceContextPanelProps = Omit<
  React.ComponentProps<typeof KnowledgePanel>,
  'embedded' | 'isOpen' | 'onClose' | 'showHeader'
>;

export function ContextPanelSurface(props: WorkspaceContextPanelProps) {
  return (
    <KnowledgePanel
      {...props}
      embedded
      isOpen
      onClose={() => undefined}
      showHeader={false}
    />
  );
}
