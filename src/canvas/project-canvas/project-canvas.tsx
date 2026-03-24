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
import { FileText, Globe, Pencil, Plus, Presentation, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/framework/resilience';
import { safeJsonParse } from '@/framework/resilience';
import { computeAutoLayout } from '@/canvas/layout';
import type { ProjectNodeSummary } from '@/lib/workspace/node';

// ---------------------------------------------------------------------------
// Context Menu
// ---------------------------------------------------------------------------

type ContextMenuState =
  | { kind: 'closed' }
  | {
      kind: 'node';
      nodeId: string;
      title: string;
      x: number;
      y: number;
    }
  | {
      kind: 'canvas';
      x: number;
      y: number;
    };

type RenameState = {
  nodeId: string;
  value: string;
} | null;

function CanvasContextMenu({
  edges,
  menu,
  onClose,
  onConnectNode,
  onDeleteNode,
  onDisconnectNode,
  onNewNode,
  onOpenNode,
  onStartRename,
}: {
  edges: NodeEdge[];
  menu: ContextMenuState;
  onClose: () => void;
  onConnectNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDisconnectNode: (nodeId: string, edgeId: string) => void;
  onNewNode: () => void;
  onOpenNode: (nodeId: string) => void;
  onStartRename: (nodeId: string, currentTitle: string) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (menu.kind === 'closed') return;

    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleEscape, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [menu, onClose]);

  if (menu.kind === 'closed') return null;

  const items: Array<
    | { kind: 'separator' }
    | { icon: typeof FileText; label: string; danger?: boolean; onClick: () => void }
  > =
    menu.kind === 'node'
      ? (() => {
          const nodeEdges = edges.filter(
            (e) => e.sourceNodeId === menu.nodeId || e.targetNodeId === menu.nodeId
          );
          const result: typeof items = [
            {
              icon: FileText,
              label: '打开',
              onClick: () => {
                onOpenNode(menu.nodeId);
                onClose();
              },
            },
            {
              icon: Pencil,
              label: '重命名',
              onClick: () => {
                onStartRename(menu.nodeId, menu.title);
                onClose();
              },
            },
            { kind: 'separator' },
            {
              icon: Plus,
              label: '连接到…',
              onClick: () => {
                onConnectNode(menu.nodeId);
                onClose();
              },
            },
          ];
          for (const edge of nodeEdges) {
            const otherNodeId = edge.sourceNodeId === menu.nodeId ? edge.targetNodeId : edge.sourceNodeId;
            result.push({
              icon: Trash2,
              label: `断开连接 (${otherNodeId.slice(0, 6)}…)`,
              danger: true,
              onClick: () => {
                onDisconnectNode(menu.nodeId, edge.id);
                onClose();
              },
            });
          }
          result.push({ kind: 'separator' });
          result.push({
            icon: Trash2,
            label: '删除',
            danger: true,
            onClick: () => {
              onDeleteNode(menu.nodeId);
              onClose();
            },
          });
          return result;
        })()
      : [
          {
            icon: Plus,
            label: '新建内容',
            onClick: () => {
              onNewNode();
              onClose();
            },
          },
        ];

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ left: menu.x, top: menu.y }}
      data-testid="canvas-context-menu"
    >
      {items.map((item, i) =>
        'kind' in item && item.kind === 'separator' ? (
          <div key={`sep-${i}`} className="-mx-1 my-1 h-px bg-muted" />
        ) : (
          <button
            key={i}
            type="button"
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent',
              'danger' in item && item.danger && 'text-destructive hover:text-destructive'
            )}
            onClick={'onClick' in item ? item.onClick : undefined}
          >
            {'icon' in item && item.icon ? (
              <item.icon className="h-4 w-4" />
            ) : null}
            {'label' in item ? item.label : null}
          </button>
        )
      )}
    </div>
  );
}

function RenameOverlay({
  onCancel,
  onConfirm,
  rename,
}: {
  onCancel: () => void;
  onConfirm: (nodeId: string, newTitle: string) => void;
  rename: RenameState;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [value, setValue] = React.useState('');

  React.useEffect(() => {
    if (rename) {
      setValue(rename.value);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [rename]);

  if (!rename) return null;

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== rename.value) {
      onConfirm(rename.nodeId, trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
      <div className="w-80 rounded-lg border bg-popover p-4 shadow-lg">
        <p className="mb-2 text-sm font-medium">重命名</p>
        <input
          ref={inputRef}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
            onClick={handleSubmit}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CanvasNodeMeta = {
  x: number;
  y: number;
  width?: number;
};

type CanvasMetaMap = Record<string, CanvasNodeMeta>;

type NodeEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: string;
};

// ---------------------------------------------------------------------------
// Edge persistence
// ---------------------------------------------------------------------------

async function loadNodeRelations(projectId: string): Promise<NodeEdge[]> {
  try {
    const res = await apiFetch(`/api/workspaces/${projectId}/node-relations`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.relations || [];
  } catch {
    return [];
  }
}

async function createNodeRelation(
  projectId: string,
  sourceNodeId: string,
  targetNodeId: string
): Promise<NodeEdge | null> {
  try {
    const res = await apiFetch(`/api/workspaces/${projectId}/node-relations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceNodeId, targetNodeId, kind: 'dependency' }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function deleteNodeRelation(projectId: string, relationId: string): Promise<void> {
  try {
    await apiFetch(`/api/workspaces/${projectId}/node-relations?id=${relationId}`, {
      method: 'DELETE',
    });
  } catch {
    // Silent fail
  }
}

// ---------------------------------------------------------------------------
// Node Card Shape – custom tldraw shape
// ---------------------------------------------------------------------------

const NODE_CARD_TYPE = 'node-card' as const;

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    [NODE_CARD_TYPE]: {
      w: number;
      h: number;
      nodeId: string;
      title: string;
      status: string;
      previewText: string;
      renderAs: string;
      isCurrent: boolean;
    };
  }
}

type NodeCardShape = TLShape<typeof NODE_CARD_TYPE>;

const CARD_WIDTH = 240;
const CARD_HEIGHT = 120;

function NodeCardContent({ shape }: { shape: NodeCardShape }) {
  const { title, status, previewText, renderAs, isCurrent } = shape.props;

  const statusColor =
    status === 'completed'
      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
      : status === 'active' || status === 'working'
        ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
        : 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400';

  const TypeIcon =
    renderAs === 'web'
      ? Globe
      : renderAs === 'slides'
        ? Presentation
        : FileText;

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col gap-1.5 rounded-lg border bg-background p-3 shadow-sm transition-shadow select-none',
        'hover:shadow-md',
        isCurrent && 'ring-2 ring-primary/60'
      )}
      style={{ pointerEvents: 'all' }}
    >
      <div className="flex items-start gap-2">
        <TypeIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium leading-tight line-clamp-2 flex-1">
          {title || 'Untitled'}
        </span>
      </div>
      <span className={cn('inline-flex w-fit rounded-full px-1.5 py-0.5 text-[10px] font-medium', statusColor)}>
        {status}
      </span>
      {previewText ? (
        <p className="text-[11px] leading-snug text-muted-foreground line-clamp-2">
          {previewText}
        </p>
      ) : null}
    </div>
  );
}

class NodeCardShapeUtil extends ShapeUtil<NodeCardShape> {
  static override type = NODE_CARD_TYPE as string;

  getDefaultProps(): NodeCardShape['props'] {
    return {
      w: CARD_WIDTH,
      h: CARD_HEIGHT,
      nodeId: '',
      title: 'Untitled',
      status: 'draft',
      previewText: '',
      renderAs: 'document',
      isCurrent: false,
    };
  }

  getGeometry(shape: NodeCardShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  component(shape: NodeCardShape) {
    return (
      <HTMLContainer>
        <NodeCardContent shape={shape} />
      </HTMLContainer>
    );
  }

  indicator(shape: NodeCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }
}

const shapeUtils = [NodeCardShapeUtil];

// ---------------------------------------------------------------------------
// Canvas meta persistence
// ---------------------------------------------------------------------------

async function loadCanvasMeta(workspaceId: string): Promise<CanvasMetaMap> {
  try {
    const res = await apiFetch(`/api/workspaces/${workspaceId}/canvas-meta`);
    if (!res.ok) {
      return {};
    }

    const data = await res.json();
    return safeJsonParse<CanvasMetaMap>(data.canvasMetaJson || '{}', {});
  } catch {
    return {};
  }
}

async function saveCanvasMeta(workspaceId: string, meta: CanvasMetaMap): Promise<void> {
  try {
    await apiFetch(`/api/workspaces/${workspaceId}/canvas-meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvasMetaJson: JSON.stringify(meta) }),
    });
  } catch {
    // Silent fail – coordinates will be re-laid out on next open
  }
}

// ---------------------------------------------------------------------------
// ProjectCanvas component
// ---------------------------------------------------------------------------

export function ProjectCanvas({
  nodes,
  onDeleteNode,
  onDoubleClickNode,
  onNewNode,
  onRenameNode,
  projectId,
  projectTitle,
}: {
  nodes: ProjectNodeSummary[];
  onDeleteNode?: (nodeId: string) => void;
  onDoubleClickNode?: (nodeId: string) => void;
  onNewNode?: () => void;
  onRenameNode?: (nodeId: string, newTitle: string) => void;
  projectId: string;
  projectTitle: string;
}) {
  const editorRef = React.useRef<Editor | null>(null);
  const canvasMetaRef = React.useRef<CanvasMetaMap>({});
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState>({ kind: 'closed' });
  const [rename, setRename] = React.useState<RenameState>(null);
  const [edges, setEdges] = React.useState<NodeEdge[]>([]);
  const [connectSourceId, setConnectSourceId] = React.useState<string | null>(null);
  const [edgePositions, setEdgePositions] = React.useState<Record<string, { x: number; y: number }>>({}); 

  // Load canvas meta on mount
  React.useEffect(() => {
    let cancelled = false;

    void loadCanvasMeta(projectId).then((meta) => {
      if (cancelled) return;
      canvasMetaRef.current = meta;
      setReady(true);
    });

    void loadNodeRelations(projectId).then((loadedEdges) => {
      if (cancelled) return;
      setEdges(loadedEdges);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Debounced save
  const scheduleSave = React.useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      void saveCanvasMeta(projectId, canvasMetaRef.current);
    }, 800);
  }, [projectId]);

  // Cleanup save timer
  React.useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        // Flush pending save
        void saveCanvasMeta(projectId, canvasMetaRef.current);
      }
    };
  }, [projectId]);

  const handleMount = React.useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      const meta = canvasMetaRef.current;

      // Create shapes from nodes
      const autoPositions = computeAutoLayout(nodes.length);
      const shapes = nodes.map((node, index) => {
        const savedPos = meta[node.id];
        const layoutPos = autoPositions[index];
        const x = savedPos?.x ?? layoutPos.x;
        const y = savedPos?.y ?? layoutPos.y;

        return {
          id: createShapeId(node.id) as TLShapeId,
          type: NODE_CARD_TYPE,
          x,
          y,
          props: {
            w: CARD_WIDTH,
            h: CARD_HEIGHT,
            nodeId: node.id,
            title: node.title,
            status: node.status,
            previewText: node.previewText,
            renderAs: node.renderAs,
            isCurrent: node.isCurrent,
          },
        };
      });

      editor.createShapes(shapes);

      // Zoom to fit all shapes
      editor.zoomToFit({ animation: { duration: 0 } });

      // Listen for shape changes to persist positions
      const handleChange = () => {
        const allShapes = editor.getCurrentPageShapes();
        let changed = false;

        for (const shape of allShapes) {
          if (shape.type !== NODE_CARD_TYPE) continue;
          const nodeCard = shape as NodeCardShape;
          const nodeId = nodeCard.props.nodeId;
          const prev = meta[nodeId];
          if (!prev || prev.x !== shape.x || prev.y !== shape.y) {
            meta[nodeId] = { x: shape.x, y: shape.y };
            changed = true;
          }
        }

        if (changed) {
          scheduleSave();
        }
      };

      // tldraw uses store.listen for tracking changes
      const cleanup = editor.store.listen(handleChange, {
        scope: 'document',
        source: 'user',
      });

      // Sync edge positions whenever shapes change
      const posSync = editor.store.listen(
        () => {
          const allShapes = editor.getCurrentPageShapes();
          const pos: Record<string, { x: number; y: number }> = {};
          for (const shape of allShapes) {
            if (shape.type !== NODE_CARD_TYPE) continue;
            const nodeCard = shape as NodeCardShape;
            pos[nodeCard.props.nodeId] = {
              x: shape.x + nodeCard.props.w / 2,
              y: shape.y + nodeCard.props.h / 2,
            };
          }
          setEdgePositions(pos);
        },
        { scope: 'document', source: 'all' }
      );

      // Initial position sync
      const allShapes = editor.getCurrentPageShapes();
      const pos: Record<string, { x: number; y: number }> = {};
      for (const shape of allShapes) {
        if (shape.type !== NODE_CARD_TYPE) continue;
        const nodeCard = shape as NodeCardShape;
        pos[nodeCard.props.nodeId] = {
          x: shape.x + nodeCard.props.w / 2,
          y: shape.y + nodeCard.props.h / 2,
        };
      }
      setEdgePositions(pos);

      return () => {
        if (typeof cleanup === 'function') cleanup();
        posSync();
      };
    },
    [nodes, scheduleSave]
  );

  const handleDoubleClick = React.useCallback(
    (editor: Editor) => {
      if (!onDoubleClickNode) return;

      const selectedShapes = editor.getSelectedShapes();
      if (selectedShapes.length !== 1) return;

      const shape = selectedShapes[0];
      if (shape.type !== NODE_CARD_TYPE) return;

      const nodeId = (shape as NodeCardShape).props.nodeId;
      if (nodeId) {
        onDoubleClickNode(nodeId);
      }
    },
    [onDoubleClickNode]
  );

  const closeMenu = React.useCallback(() => setContextMenu({ kind: 'closed' }), []);

  const handleContextMenu = React.useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      const editor = editorRef.current;
      if (!editor) return;

      // Check if we right-clicked on a shape
      const point = editor.screenToPage({ x: e.clientX, y: e.clientY });
      const shapesAtPoint = editor.getShapesAtPoint(point);
      const nodeShape = shapesAtPoint.find(
        (s) => s.type === NODE_CARD_TYPE
      ) as NodeCardShape | undefined;

      if (nodeShape) {
        setContextMenu({
          kind: 'node',
          nodeId: nodeShape.props.nodeId,
          title: nodeShape.props.title,
          x: e.clientX,
          y: e.clientY,
        });
        editor.select(nodeShape.id);
      } else {
        setContextMenu({
          kind: 'canvas',
          x: e.clientX,
          y: e.clientY,
        });
      }
    },
    []
  );

  const handleDeleteNode = React.useCallback(
    (nodeId: string) => {
      if (onDeleteNode) {
        onDeleteNode(nodeId);
      }
      // Remove shape from canvas immediately
      const editor = editorRef.current;
      if (editor) {
        const shapeId = createShapeId(nodeId) as TLShapeId;
        editor.deleteShapes([shapeId]);
      }
    },
    [onDeleteNode]
  );

  const handleRenameConfirm = React.useCallback(
    (nodeId: string, newTitle: string) => {
      setRename(null);
      if (onRenameNode) {
        onRenameNode(nodeId, newTitle);
      }
      // Update shape title on canvas immediately
      const editor = editorRef.current;
      if (editor) {
        const shapeId = createShapeId(nodeId) as TLShapeId;
        editor.updateShapes([
          {
            id: shapeId,
            type: NODE_CARD_TYPE,
            props: { title: newTitle },
          },
        ]);
      }
    },
    [onRenameNode]
  );

  const handleConnectNode = React.useCallback(
    (nodeId: string) => {
      if (connectSourceId) {
        if (connectSourceId !== nodeId) {
          void createNodeRelation(projectId, connectSourceId, nodeId).then((edge) => {
            if (edge) {
              setEdges((prev) => [...prev, edge]);
            }
          });
        }
        setConnectSourceId(null);
      } else {
        setConnectSourceId(nodeId);
      }
    },
    [connectSourceId, projectId]
  );

  const handleDisconnectNode = React.useCallback(
    (_nodeId: string, edgeId: string) => {
      setEdges((prev) => prev.filter((e) => e.id !== edgeId));
      void deleteNodeRelation(projectId, edgeId);
    },
    [projectId]
  );

  // Handle click on canvas shapes during connect mode
  React.useEffect(() => {
    if (!connectSourceId) return;
    const editor = editorRef.current;
    if (!editor) return;

    function handleConnectClick() {
      const selected = editor!.getSelectedShapes();
      if (selected.length === 1 && selected[0].type === NODE_CARD_TYPE) {
        const targetNodeId = (selected[0] as NodeCardShape).props.nodeId;
        if (targetNodeId && targetNodeId !== connectSourceId) {
          void createNodeRelation(projectId, connectSourceId!, targetNodeId).then((edge) => {
            if (edge) {
              setEdges((prev) => [...prev, edge]);
            }
          });
        }
      }
      setConnectSourceId(null);
    }

    const container = editor.getContainer();
    container.addEventListener('click', handleConnectClick, { once: true });
    return () => {
      container.removeEventListener('click', handleConnectClick);
    };
  }, [connectSourceId, projectId]);

  // Compute screen-space edge positions from tldraw camera
  const screenEdges = React.useMemo(() => {
    const editor = editorRef.current;
    if (!editor || edges.length === 0) return [];

    return edges
      .map((edge) => {
        const src = edgePositions[edge.sourceNodeId];
        const tgt = edgePositions[edge.targetNodeId];
        if (!src || !tgt) return null;

        const srcScreen = editor.pageToViewport(src);
        const tgtScreen = editor.pageToViewport(tgt);

        return {
          id: edge.id,
          x1: srcScreen.x,
          y1: srcScreen.y,
          x2: tgtScreen.x,
          y2: tgtScreen.y,
        };
      })
      .filter(Boolean) as Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>;
  }, [edges, edgePositions]);

  if (!ready) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        Loading canvas...
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" data-testid="project-canvas">
      <div className="absolute left-3 top-3 z-10 rounded-md bg-background/80 px-3 py-1.5 text-sm font-medium backdrop-blur-sm">
        {projectTitle}
      </div>
      {connectSourceId && (
        <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-md bg-primary/90 px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-lg">
          点击目标节点完成连接…
          <button
            type="button"
            className="ml-3 text-xs underline opacity-80 hover:opacity-100"
            onClick={() => setConnectSourceId(null)}
          >
            取消
          </button>
        </div>
      )}
      <Tldraw
        shapeUtils={shapeUtils}
        onMount={(editor) => {
          const cleanup = handleMount(editor);

          // Handle double-click via native DOM event on the canvas container
          const container = editor.getContainer();
          const onDblClick = () => {
            handleDoubleClick(editor);
          };
          container.addEventListener('dblclick', onDblClick);

          // Handle right-click for context menu
          const onCtxMenu = (e: MouseEvent) => {
            handleContextMenu(e);
          };
          container.addEventListener('contextmenu', onCtxMenu);

          return () => {
            if (typeof cleanup === 'function') {
              cleanup();
            }
            container.removeEventListener('dblclick', onDblClick);
            container.removeEventListener('contextmenu', onCtxMenu);
          };
        }}
        // Hide default UI elements we don't need
        hideUi
      />
      {/* SVG edge overlay */}
      {screenEdges.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 z-[5]"
          width="100%"
          height="100%"
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="10"
              refY="3.5"
              orient="auto"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                fill="currentColor"
                className="text-muted-foreground/60"
              />
            </marker>
          </defs>
          {screenEdges.map((edge) => (
            <line
              key={edge.id}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke="currentColor"
              className="text-muted-foreground/40"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              markerEnd="url(#arrowhead)"
            />
          ))}
        </svg>
      )}
      <CanvasContextMenu
        edges={edges}
        menu={contextMenu}
        onClose={closeMenu}
        onConnectNode={handleConnectNode}
        onDeleteNode={handleDeleteNode}
        onDisconnectNode={handleDisconnectNode}
        onNewNode={onNewNode || (() => {})}
        onOpenNode={onDoubleClickNode || (() => {})}
        onStartRename={(nodeId, title) => setRename({ nodeId, value: title })}
      />
      <RenameOverlay
        onCancel={() => setRename(null)}
        onConfirm={handleRenameConfirm}
        rename={rename}
      />
    </div>
  );
}
