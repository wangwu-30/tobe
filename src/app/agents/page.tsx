import * as React from 'react';

import { AgentManagementPage } from '@/components/agents/agent-management-page';

export default function AgentsPage() {
  return (
    <React.Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AgentManagementPage />
    </React.Suspense>
  );
}
