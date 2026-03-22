import { notFound } from 'next/navigation';

import { ResilienceDebugPage } from '@/components/debug/resilience-debug-page';

export default function DebugResiliencePage() {
  if (process.env.DAO_E2E !== '1') {
    notFound();
  }

  return <ResilienceDebugPage />;
}
