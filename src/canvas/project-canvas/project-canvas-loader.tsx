'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { apiFetch } from '@/framework/resilience';
import type { ProjectNodeSummary } from '@/lib/workspace/node';

// Dynamic import to avoid SSR issues with tldraw
const ProjectCanvas = dynamic(
  () => import('./project-canvas').then((mod) => ({ default: mod.ProjectCanvas })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        Loading canvas...
      </div>
    ),
  }
);

type ProjectNodeCatalog = {
  id: string;
  nodes: ProjectNodeSummary[];
  title: string;
};

export function ProjectCanvasLoader({
  currentNodeId,
  onDeleteNode,
  onDoubleClickNode,
  onNewNode,
  onRenameNode,
  projectId,
}: {
  currentNodeId: string;
  onDeleteNode?: (nodeId: string) => void;
  onDoubleClickNode?: (nodeId: string) => void;
  onNewNode?: () => void;
  onRenameNode?: (nodeId: string, newTitle: string) => void;
  projectId: string;
}) {
  const [catalog, setCatalog] = React.useState<ProjectNodeCatalog | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const params = new URLSearchParams();
        if (currentNodeId) {
          params.set('currentNodeId', currentNodeId);
        }

        const res = await apiFetch(
          `/api/workspaces/${projectId}/node-catalog?${params.toString()}`
        );

        if (cancelled) return;

        if (!res.ok) {
          setError('Failed to load project structure');
          return;
        }

        const data = await res.json();
        setCatalog(data);
      } catch {
        if (!cancelled) {
          setError('Failed to load project structure');
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [currentNodeId, projectId]);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        {error}
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (catalog.nodes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        No items in this project yet
      </div>
    );
  }

  return (
    <ProjectCanvas
      nodes={catalog.nodes}
      onDeleteNode={onDeleteNode}
      onDoubleClickNode={onDoubleClickNode}
      onNewNode={onNewNode}
      onRenameNode={onRenameNode}
      projectId={projectId}
      projectTitle={catalog.title}
    />
  );
}
