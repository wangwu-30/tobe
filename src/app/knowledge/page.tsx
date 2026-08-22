import { Suspense } from 'react';

import { KnowledgeCenter } from '@/components/knowledge/knowledge-center';

export default function KnowledgePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground" role="status">Loading Knowledge…</div>}>
      <KnowledgeCenter />
    </Suspense>
  );
}
