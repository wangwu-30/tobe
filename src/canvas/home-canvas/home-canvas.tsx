'use client';

import * as React from 'react';
import {
  type Editor,
  type TLShape,
  type TLShapeId,
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  Tldraw,
  createShapeId,
} from 'tldraw';
import 'tldraw/tldraw.css';
import { FolderClosed } from 'lucide-react';
import { apiFetch } from '@/framework/resilience';
import { computeProjectAutoLayout } from '@/canvas/layout';
import type { ProjectSummaryData } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MountEdge = {
  id: string;
  sourceProjectId: string;
  targetProjectId: string;
};

// ---------------------------------------------------------------------------
// Project Card Shape
// ---------------------------------------------------------------------------

const PROJECT_CARD_TYPE = 'project-card' as const;

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    [PROJECT_CARD_TYPE]: {
      w: number;
      h: number;
      projectId: string;
      title: string;
      deliverableCount: number;
      preview: string;
    };
  }
}

type ProjectCardShape = TLShape<typeof PROJECT_CARD_TYPE>;

const CARD_WIDTH = 220;
const CARD_HEIGHT = 100;

function ProjectCardContent({ shape }: { shape: ProjectCardShape }) {
  const { title, deliverableCount, preview } = shape.props;

  return (
    <div
      className="flex h-full w-full flex-col gap-1.5 rounded-lg border bg-background p-3 shadow-sm transition-shadow select-none hover:shadow-md"
      style={{ pointerEvents: 'all' }}
    >
      <div className="flex items-start gap-2">
        <FolderClosed aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium leading-tight line-clamp-2 flex-1">
          {title || 'Untitled'}
        </span>
      </div>
      <span className="inline-flex w-fit rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {deliverableCount} 份内容
      </span>
      {preview ? (
        <p className="text-[11px] leading-snug text-muted-foreground line-clamp-1">
          {preview}
        </p>
      ) : null}
    </div>
  );
}

class ProjectCardShapeUtil extends ShapeUtil<ProjectCardShape> {
  static override type = PROJECT_CARD_TYPE as string;

  getDefaultProps(): ProjectCardShape['props'] {
    return {
      w: CARD_WIDTH,
      h: CARD_HEIGHT,
      projectId: '',
      title: 'Untitled',
      deliverableCount: 0,
      preview: '',
    };
  }

  getGeometry(shape: ProjectCardShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  component(shape: ProjectCardShape) {
    return (
      <HTMLContainer>
        <ProjectCardContent shape={shape} />
      </HTMLContainer>
    );
  }

  indicator(shape: ProjectCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }
}

const shapeUtils = [ProjectCardShapeUtil];

// ---------------------------------------------------------------------------
// Layout persistence
// ---------------------------------------------------------------------------

type PositionMap = Record<string, { x: number; y: number }>;

async function loadCanvasPositions(): Promise<PositionMap> {
  try {
    const res = await apiFetch('/api/canvas-layout');
    if (!res.ok) return {};
    const data = await res.json();
    return data.positions || {};
  } catch {
    return {};
  }
}

async function saveCanvasPositions(positions: PositionMap): Promise<void> {
  try {
    await apiFetch('/api/canvas-layout', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions }),
    });
  } catch {
    // Silent fail
  }
}



// ---------------------------------------------------------------------------
// HomeCanvas component
// ---------------------------------------------------------------------------

export function HomeCanvas({
  mounts,
  onDoubleClickProject,
  projects,
}: {
  mounts: MountEdge[];
  onDoubleClickProject: (project: ProjectSummaryData) => void;
  projects: ProjectSummaryData[];
}) {
  const editorRef = React.useRef<Editor | null>(null);
  const [canvasEditor, setCanvasEditor] = React.useState<Editor | null>(null);
  const positionsRef = React.useRef<PositionMap>({});
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = React.useState(false);
  const [edgePositions, setEdgePositions] = React.useState<
    Record<string, { x: number; y: number }>
  >({});

  // Map project IDs to summaries for double-click lookup
  const projectMap = React.useMemo(() => {
    const map = new Map<string, ProjectSummaryData>();
    for (const p of projects) {
      map.set(p.id, p);
    }
    return map;
  }, [projects]);

  React.useEffect(() => {
    let cancelled = false;

    void loadCanvasPositions().then((pos) => {
      if (cancelled) return;
      positionsRef.current = pos;
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const scheduleSave = React.useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveCanvasPositions(positionsRef.current);
    }, 800);
  }, []);

  React.useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        void saveCanvasPositions(positionsRef.current);
      }
    };
  }, []);

  const handleMount = React.useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      setCanvasEditor(editor);
      const savedPos = positionsRef.current;

      const autoPositions = computeProjectAutoLayout(projects.length);
      const shapes = projects.map((project, index) => {
        const pos = savedPos[project.id];
        const layoutPos = autoPositions[index];
        return {
          id: createShapeId(project.id) as TLShapeId,
          type: PROJECT_CARD_TYPE,
          x: pos?.x ?? layoutPos.x,
          y: pos?.y ?? layoutPos.y,
          props: {
            w: CARD_WIDTH,
            h: CARD_HEIGHT,
            projectId: project.id,
            title: project.title,
            deliverableCount: project.deliverableCount,
            preview:
              project.latestDeliverableTitle || project.preview || '',
          },
        };
      });

      editor.createShapes(shapes);
      editor.zoomToFit({ animation: { duration: 0 } });

      const handleChange = () => {
        const allShapes = editor.getCurrentPageShapes();
        let changed = false;

        for (const shape of allShapes) {
          if (shape.type !== PROJECT_CARD_TYPE) continue;
          const card = shape as ProjectCardShape;
          const prevPos = savedPos[card.props.projectId];
          if (!prevPos || prevPos.x !== shape.x || prevPos.y !== shape.y) {
            savedPos[card.props.projectId] = { x: shape.x, y: shape.y };
            changed = true;
          }
        }

        if (changed) scheduleSave();
      };

      const cleanup = editor.store.listen(handleChange, {
        scope: 'document',
        source: 'user',
      });

      // Sync edge positions
      const posSync = editor.store.listen(
        () => {
          const allShapes = editor.getCurrentPageShapes();
          const pos: Record<string, { x: number; y: number }> = {};
          for (const shape of allShapes) {
            if (shape.type !== PROJECT_CARD_TYPE) continue;
            const card = shape as ProjectCardShape;
            pos[card.props.projectId] = {
              x: shape.x + card.props.w / 2,
              y: shape.y + card.props.h / 2,
            };
          }
          setEdgePositions(pos);
        },
        { scope: 'document', source: 'all' }
      );

      // Initial edge position sync
      const allShapes = editor.getCurrentPageShapes();
      const initPos: Record<string, { x: number; y: number }> = {};
      for (const shape of allShapes) {
        if (shape.type !== PROJECT_CARD_TYPE) continue;
        const card = shape as ProjectCardShape;
        initPos[card.props.projectId] = {
          x: shape.x + card.props.w / 2,
          y: shape.y + card.props.h / 2,
        };
      }
      setEdgePositions(initPos);

      return () => {
        if (typeof cleanup === 'function') cleanup();
        posSync();
      };
    },
    [projects, scheduleSave]
  );

  const handleDoubleClick = React.useCallback(
    (editor: Editor) => {
      const selected = editor.getSelectedShapes();
      if (selected.length !== 1 || selected[0].type !== PROJECT_CARD_TYPE) return;
      const projectId = (selected[0] as ProjectCardShape).props.projectId;
      const project = projectMap.get(projectId);
      if (project) onDoubleClickProject(project);
    },
    [onDoubleClickProject, projectMap]
  );

  // Compute screen-space mount edges
  const screenMounts = React.useMemo(() => {
    if (!canvasEditor || mounts.length === 0) return [];

    return mounts
      .map((mount) => {
        const src = edgePositions[mount.sourceProjectId];
        const tgt = edgePositions[mount.targetProjectId];
        if (!src || !tgt) return null;

        const srcScreen = canvasEditor.pageToViewport(src);
        const tgtScreen = canvasEditor.pageToViewport(tgt);

        return {
          id: mount.id,
          x1: srcScreen.x,
          y1: srcScreen.y,
          x2: tgtScreen.x,
          y2: tgtScreen.y,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }>;
  }, [canvasEditor, mounts, edgePositions]);

  if (!ready) {
    return (
      <div aria-live="polite" className="flex h-full w-full items-center justify-center text-muted-foreground" role="status">
        Loading canvas…
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" data-testid="home-canvas">
      <Tldraw
        shapeUtils={shapeUtils}
        onMount={(editor) => {
          const cleanup = handleMount(editor);

          const container = editor.getContainer();
          const onDblClick = () => handleDoubleClick(editor);
          container.addEventListener('dblclick', onDblClick);

          return () => {
            if (typeof cleanup === 'function') cleanup();
            container.removeEventListener('dblclick', onDblClick);
          };
        }}
        hideUi
      />
      {/* SVG mount-line overlay */}
      {screenMounts.length > 0 && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[5]"
          width="100%"
          height="100%"
        >
          <defs>
            <marker
              id="mount-arrow"
              markerWidth="8"
              markerHeight="6"
              refX="8"
              refY="3"
              orient="auto"
            >
              <polygon
                points="0 0, 8 3, 0 6"
                fill="currentColor"
                className="text-blue-400/60"
              />
            </marker>
          </defs>
          {screenMounts.map((edge) => (
            <line
              key={edge.id}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke="currentColor"
              className="text-blue-400/30"
              strokeWidth={2}
              strokeDasharray="8 4"
              markerEnd="url(#mount-arrow)"
            />
          ))}
        </svg>
      )}
    </div>
  );
}
