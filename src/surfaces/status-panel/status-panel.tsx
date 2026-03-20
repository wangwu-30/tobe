'use client';

import * as React from 'react';

import { PlanPanel } from '@/components/workspace/plan-panel';

export function StatusPanelSurface(props: React.ComponentProps<typeof PlanPanel>) {
  return <PlanPanel {...props} />;
}
