'use client';

import * as React from 'react';

import { ChatPanel } from '@/components/chat/chat-panel';

type WorkspaceAssistantPanelProps = Omit<
  React.ComponentProps<typeof ChatPanel>,
  'showHeader'
>;

export function AssistantPanelSurface(props: WorkspaceAssistantPanelProps) {
  return <ChatPanel {...props} showHeader={false} />;
}
