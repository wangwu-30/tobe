'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { apiFetch } from '@/framework/resilience';
import type { ProjectSummaryData } from '@/types';

const HomeCanvas = dynamic(
  () => import('./home-canvas').then((mod) => ({ default: mod.HomeCanvas })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        Loading canvas...
      </div>
    ),
  }
);

type MountEdge = {
  id: string;
  sourceProjectId: string;
  targetProjectId: string;
};

export function HomeCanvasLoader({
  onDoubleClickProject,
  projects,
}: {
  onDoubleClickProject: (project: ProjectSummaryData) => void;
  projects: ProjectSummaryData[];
}) {
  const [mounts, setMounts] = React.useState<MountEdge[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await apiFetch('/api/project-mounts');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setMounts(data.mounts || []);
      } catch {
        // Mount loading is optional
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  if (projects.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        No projects yet
      </div>
    );
  }

  return (
    <HomeCanvas
      mounts={mounts}
      onDoubleClickProject={onDoubleClickProject}
      projects={projects}
    />
  );
}
