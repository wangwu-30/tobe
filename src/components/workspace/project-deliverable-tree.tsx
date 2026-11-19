'use client';

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  FilePlus2,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/components/providers/language-provider';
import {
  DeliverableTypeBadge,
  DeliverableTypeIcon,
} from '@/components/workspace/deliverable-type-badge';
import { cn } from '@/lib/utils';
import type { ProjectDeliverableItem, ProjectFolderItem } from '@/types';

export type ProjectTreeMoveNode = {
  currentParentFolderId: string | null;
  id: string;
  title: string;
  type: 'deliverable' | 'folder';
};

export type ProjectDeliverableTreeNode = ProjectDeliverableItem & {
  children: ProjectDeliverableTreeNode[];
  depth: number;
  nodeType: 'deliverable';
};

export type ProjectFolderTreeNode = ProjectFolderItem & {
  children: ProjectTreeNode[];
  depth: number;
  nodeType: 'folder';
};

export type ProjectTreeNode = ProjectFolderTreeNode | ProjectDeliverableTreeNode;

export function ProjectDeliverableTree({
  currentWorkspaceId,
  dragNode,
  folders,
  deliverables,
  dropTargetFolderId,
  onCreateDeliverable,
  onCreateProjectFolder,
  onCreateSiblingDeliverable,
  onDeleteDeliverable,
  onDeleteProjectFolder,
  onMoveDeliverable,
  onMoveProjectFolder,
  onOpenDeliverable,
  onReorderDeliverable,
  onReorderProjectFolder,
  onDragEndNode,
  onDragStartNode,
  onDropNodeOnFolder,
  onDropNodeOnRoot,
  onSetDropTargetFolderId,
  onRequestRenameDeliverable,
  onRequestRenameProjectFolder,
}: {
  currentWorkspaceId?: string | null;
  dragNode?: ProjectTreeMoveNode | null;
  folders: ProjectFolderItem[];
  deliverables: ProjectDeliverableItem[];
  dropTargetFolderId?: string | null;
  onCreateDeliverable?: (context?: {
    projectFolderId?: string | null;
  }) => Promise<void> | void;
  onCreateProjectFolder?: (parentFolderId: string | null) => Promise<void> | void;
  onCreateSiblingDeliverable?: (workspaceId: string) => Promise<void> | void;
  onDeleteDeliverable?: (workspaceId: string) => Promise<void> | void;
  onDeleteProjectFolder?: (folderId: string) => Promise<void> | void;
  onMoveDeliverable?: (deliverable: ProjectDeliverableItem) => void;
  onMoveProjectFolder?: (folder: ProjectFolderItem) => void;
  onOpenDeliverable?: (workspaceId: string) => void;
  onReorderDeliverable?: (
    deliverable: ProjectDeliverableTreeNode,
    direction: 'up' | 'down'
  ) => void;
  onReorderProjectFolder?: (
    folder: ProjectFolderTreeNode,
    direction: 'up' | 'down'
  ) => void;
  onDragEndNode?: () => void;
  onDragStartNode?: (node: ProjectTreeMoveNode) => void;
  onDropNodeOnFolder?: (folderId: string) => Promise<void> | void;
  onDropNodeOnRoot?: () => Promise<void> | void;
  onSetDropTargetFolderId?: (folderId: string | null) => void;
  onRequestRenameDeliverable?: (deliverable: ProjectDeliverableItem) => void;
  onRequestRenameProjectFolder?: (folder: ProjectFolderItem) => void;
}) {
  const tree = React.useMemo(
    () => buildProjectTree({ deliverables, folders }),
    [deliverables, folders]
  );
  const t = useT();

  return (
    <div className="min-w-0 space-y-1 overflow-hidden">
      {dragNode ? (
        <div
          className={cn(
            'rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground transition-colors',
            dropTargetFolderId === null && 'border-primary/60 bg-primary/5 text-foreground'
          )}
          onDragOver={(event) => {
            event.preventDefault();
            onSetDropTargetFolderId?.(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void onDropNodeOnRoot?.();
          }}
        >
          {t('sidebar.moveSupportToRoot')}
        </div>
      ) : null}
      {tree.map((node, index) => (
        <ProjectTreeNodeRow
          key={node.id}
          currentWorkspaceId={currentWorkspaceId}
          dragNode={dragNode}
          node={node}
          dropTargetFolderId={dropTargetFolderId}
          siblingCount={tree.length}
          siblingIndex={index}
          onCreateDeliverable={onCreateDeliverable}
          onCreateProjectFolder={onCreateProjectFolder}
          onCreateSiblingDeliverable={onCreateSiblingDeliverable}
          onDeleteDeliverable={onDeleteDeliverable}
          onDeleteProjectFolder={onDeleteProjectFolder}
          onMoveDeliverable={onMoveDeliverable}
          onMoveProjectFolder={onMoveProjectFolder}
          onOpenDeliverable={onOpenDeliverable}
          onReorderDeliverable={onReorderDeliverable}
          onReorderProjectFolder={onReorderProjectFolder}
          onDragEndNode={onDragEndNode}
          onDragStartNode={onDragStartNode}
          onDropNodeOnFolder={onDropNodeOnFolder}
          onSetDropTargetFolderId={onSetDropTargetFolderId}
          onRequestRenameDeliverable={onRequestRenameDeliverable}
          onRequestRenameProjectFolder={onRequestRenameProjectFolder}
        />
      ))}
    </div>
  );
}

function ProjectTreeNodeRow({
  currentWorkspaceId,
  dragNode,
  node,
  dropTargetFolderId,
  siblingCount,
  siblingIndex,
  onCreateDeliverable,
  onCreateProjectFolder,
  onCreateSiblingDeliverable,
  onDeleteDeliverable,
  onDeleteProjectFolder,
  onMoveDeliverable,
  onMoveProjectFolder,
  onOpenDeliverable,
  onReorderDeliverable,
  onReorderProjectFolder,
  onDragEndNode,
  onDragStartNode,
  onDropNodeOnFolder,
  onSetDropTargetFolderId,
  onRequestRenameDeliverable,
  onRequestRenameProjectFolder,
}: {
  currentWorkspaceId?: string | null;
  dragNode?: ProjectTreeMoveNode | null;
  node: ProjectTreeNode;
  dropTargetFolderId?: string | null;
  siblingCount: number;
  siblingIndex: number;
  onCreateDeliverable?: (context?: {
    projectFolderId?: string | null;
  }) => Promise<void> | void;
  onCreateProjectFolder?: (parentFolderId: string | null) => Promise<void> | void;
  onCreateSiblingDeliverable?: (workspaceId: string) => Promise<void> | void;
  onDeleteDeliverable?: (workspaceId: string) => Promise<void> | void;
  onDeleteProjectFolder?: (folderId: string) => Promise<void> | void;
  onMoveDeliverable?: (deliverable: ProjectDeliverableItem) => void;
  onMoveProjectFolder?: (folder: ProjectFolderItem) => void;
  onOpenDeliverable?: (workspaceId: string) => void;
  onReorderDeliverable?: (
    deliverable: ProjectDeliverableTreeNode,
    direction: 'up' | 'down'
  ) => void;
  onReorderProjectFolder?: (
    folder: ProjectFolderTreeNode,
    direction: 'up' | 'down'
  ) => void;
  onDragEndNode?: () => void;
  onDragStartNode?: (node: ProjectTreeMoveNode) => void;
  onDropNodeOnFolder?: (folderId: string) => Promise<void> | void;
  onSetDropTargetFolderId?: (folderId: string | null) => void;
  onRequestRenameDeliverable?: (deliverable: ProjectDeliverableItem) => void;
  onRequestRenameProjectFolder?: (folder: ProjectFolderItem) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(true);
  const hasChildren = node.children.length > 0;
  const isFolder = node.nodeType === 'folder';
  const isActiveDeliverable = !isFolder && currentWorkspaceId === node.id;
  const isDropTarget = isFolder && dragNode && dropTargetFolderId === node.id;
  const canMoveUp = siblingIndex > 0;
  const canMoveDown = siblingIndex < siblingCount - 1;
  const showCreateNextAction = isActiveDeliverable && Boolean(onCreateSiblingDeliverable);

  return (
    <div className="min-w-0 overflow-hidden">
      <div
        data-testid={
          !isFolder
            ? isActiveDeliverable
              ? `sidebar-project-tree-current-${node.id}`
              : `sidebar-project-tree-deliverable-${node.id}`
            : undefined
        }
        className={cn(
          'group flex min-w-0 items-center gap-2 overflow-hidden rounded-xl px-2 py-1.5 transition-colors hover:bg-accent',
          isActiveDeliverable && 'bg-background shadow-sm ring-1 ring-border',
          isDropTarget && 'bg-primary/5 ring-1 ring-primary/40'
        )}
        style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
        draggable={Boolean(onDragStartNode)}
        onDragEnd={() => onDragEndNode?.()}
        onDragStart={(event) => {
          if (!onDragStartNode) {
            return;
          }

          event.dataTransfer.effectAllowed = 'move';
          onDragStartNode(toProjectTreeMoveNode(node));
        }}
        onDragOver={(event) => {
          if (!isFolder || !dragNode) {
            return;
          }

          event.preventDefault();
          onSetDropTargetFolderId?.(node.id);
          setOpen(true);
        }}
        onDrop={(event) => {
          if (!isFolder) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          void onDropNodeOnFolder?.(node.id);
        }}
      >
        {isFolder ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 touch-manipulation items-center gap-2 overflow-hidden rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="block truncate text-sm">{node.title}</span>
          </button>
        ) : (
          <button
            type="button"
            className="flex min-w-0 flex-1 touch-manipulation items-center gap-2 overflow-hidden rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            data-testid={`sidebar-project-tree-open-${node.id}`}
            title={node.title}
            onClick={() => {
              if (hasChildren && isActiveDeliverable) {
                setOpen((value) => !value);
                return;
              }

              onOpenDeliverable?.(node.id);
            }}
          >
            <DeliverableTypeIcon
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              deliverableType={node.deliverableType}
            />
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <span className="block min-w-0 flex-1 truncate text-sm">{node.title}</span>
              <DeliverableTypeBadge
                className="shrink-0"
                deliverableType={node.deliverableType}
              />
              {isActiveDeliverable ? (
                <Badge
                  variant="secondary"
                  className="px-1.5 py-0 text-[10px]"
                  data-testid={`sidebar-project-tree-current-badge-${node.id}`}
                >
                  {t('sidebar.currentDeliverableBadge')}
                </Badge>
              ) : null}
            </div>
          </button>
        )}

        {showCreateNextAction ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-7 shrink-0 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            data-testid={`sidebar-project-tree-create-next-${node.id}`}
            draggable={false}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onDragStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              void onCreateSiblingDeliverable?.(node.id);
            }}
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            {t('sidebar.newDeliverableHere')}
          </Button>
        ) : null}

        {isFolder ? (
          onCreateDeliverable ||
          onCreateProjectFolder ||
          onMoveProjectFolder ||
          onRequestRenameProjectFolder ||
          onDeleteProjectFolder ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`${t('sidebar.projectTree')}: ${node.title}`}
                  size="icon-xs"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onCreateDeliverable ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      void onCreateDeliverable({
                        projectFolderId: node.id,
                      })
                    }
                  >
                    <FilePlus2 className="h-3.5 w-3.5" />
                    {t('sidebar.newDeliverable')}
                  </DropdownMenuItem>
                ) : null}
                {onCreateProjectFolder ? (
                  <DropdownMenuItem onSelect={() => void onCreateProjectFolder(node.id)}>
                    <FolderPlus className="h-3.5 w-3.5" />
                    {t('sidebar.newProjectFolder')}
                  </DropdownMenuItem>
                ) : null}
                {onReorderProjectFolder ? (
                  <DropdownMenuItem
                    disabled={!canMoveUp}
                    onSelect={() => onReorderProjectFolder(node, 'up')}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                    {t('sidebar.moveUp')}
                  </DropdownMenuItem>
                ) : null}
                {onReorderProjectFolder ? (
                  <DropdownMenuItem
                    disabled={!canMoveDown}
                    onSelect={() => onReorderProjectFolder(node, 'down')}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                    {t('sidebar.moveDown')}
                  </DropdownMenuItem>
                ) : null}
                {onMoveProjectFolder ? (
                  <DropdownMenuItem onSelect={() => onMoveProjectFolder(node)}>
                    <FolderOpen className="h-3.5 w-3.5" />
                    {t('sidebar.moveProjectFolder')}
                  </DropdownMenuItem>
                ) : null}
                {onRequestRenameProjectFolder ? (
                  <DropdownMenuItem onSelect={() => onRequestRenameProjectFolder(node)}>
                    <Pencil className="h-3.5 w-3.5" />
                    {t('sidebar.renameProjectFolder')}
                  </DropdownMenuItem>
                ) : null}
                {onDeleteProjectFolder ? (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => void onDeleteProjectFolder(node.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('sidebar.deleteProjectFolder')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        ) : onCreateSiblingDeliverable ||
            onMoveDeliverable ||
            onRequestRenameDeliverable ||
            onDeleteDeliverable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`${t('sidebar.projectDeliverables')}: ${node.title}`}
                size="icon-xs"
                variant="ghost"
                className={cn(
                  'h-7 w-7 shrink-0 transition-opacity',
                  isActiveDeliverable ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onCreateSiblingDeliverable ? (
                <DropdownMenuItem onSelect={() => void onCreateSiblingDeliverable(node.id)}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('sidebar.newDeliverableHere')}
                </DropdownMenuItem>
              ) : null}
              {onRequestRenameDeliverable ? (
                <DropdownMenuItem onSelect={() => onRequestRenameDeliverable(node)}>
                  <Pencil className="h-3.5 w-3.5" />
                  {t('sidebar.renameDeliverable')}
                </DropdownMenuItem>
              ) : null}
              {onReorderDeliverable ? (
                <DropdownMenuItem
                  disabled={!canMoveUp}
                  onSelect={() => onReorderDeliverable(node, 'up')}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  {t('sidebar.moveUp')}
                </DropdownMenuItem>
              ) : null}
              {onReorderDeliverable ? (
                <DropdownMenuItem
                  disabled={!canMoveDown}
                  onSelect={() => onReorderDeliverable(node, 'down')}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  {t('sidebar.moveDown')}
                </DropdownMenuItem>
              ) : null}
              {onMoveDeliverable ? (
                <DropdownMenuItem onSelect={() => onMoveDeliverable(node)}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t('sidebar.moveDeliverable')}
                </DropdownMenuItem>
              ) : null}
              {onDeleteDeliverable ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => void onDeleteDeliverable(node.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('sidebar.deleteDeliverable')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {hasChildren && open ? (
        <div className="mt-0.5 min-w-0 space-y-1 overflow-hidden">
          {node.children.map((child, index) => (
            <ProjectTreeNodeRow
              key={child.id}
              currentWorkspaceId={currentWorkspaceId}
              dragNode={dragNode}
              node={child}
              dropTargetFolderId={dropTargetFolderId}
              siblingCount={node.children.length}
              siblingIndex={index}
              onCreateDeliverable={onCreateDeliverable}
              onCreateProjectFolder={onCreateProjectFolder}
              onCreateSiblingDeliverable={onCreateSiblingDeliverable}
              onDeleteDeliverable={onDeleteDeliverable}
              onDeleteProjectFolder={onDeleteProjectFolder}
              onMoveDeliverable={onMoveDeliverable}
              onMoveProjectFolder={onMoveProjectFolder}
              onOpenDeliverable={onOpenDeliverable}
              onReorderDeliverable={onReorderDeliverable}
              onReorderProjectFolder={onReorderProjectFolder}
              onDragEndNode={onDragEndNode}
              onDragStartNode={onDragStartNode}
              onDropNodeOnFolder={onDropNodeOnFolder}
              onSetDropTargetFolderId={onSetDropTargetFolderId}
              onRequestRenameDeliverable={onRequestRenameDeliverable}
              onRequestRenameProjectFolder={onRequestRenameProjectFolder}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function buildProjectTree({
  deliverables,
  folders,
}: {
  deliverables: ProjectDeliverableItem[];
  folders: ProjectFolderItem[];
}) {
  const nodeMap = new Map<string, ProjectDeliverableTreeNode>();
  const folderMap = new Map<string, ProjectFolderTreeNode>();
  const roots: ProjectTreeNode[] = [];

  deliverables.forEach((deliverable) => {
    nodeMap.set(deliverable.id, {
      ...deliverable,
      children: [],
      depth: 0,
      nodeType: 'deliverable',
    });
  });

  folders.forEach((folder) => {
    folderMap.set(folder.id, {
      ...folder,
      children: [],
      depth: 0,
      nodeType: 'folder',
    });
  });

  folderMap.forEach((folder) => {
    if (folder.parentFolderId) {
      const parent = folderMap.get(folder.parentFolderId);
      if (parent) {
        parent.children.push(folder);
        return;
      }
    }

    roots.push(folder);
  });

  nodeMap.forEach((node) => {
    if (node.projectFolderId) {
      const folder = folderMap.get(node.projectFolderId);
      if (folder) {
        folder.children.push(node);
        return;
      }
    }

    roots.push(node);
  });

  const sortTree = (nodes: ProjectTreeNode[]) => {
    nodes.sort(compareProjectTreeItems);
    nodes.forEach((treeNode) => sortTree(treeNode.children));
  };

  const assignDepth = (nodes: ProjectTreeNode[], depth = 0) => {
    nodes.forEach((treeNode) => {
      treeNode.depth = depth;
      assignDepth(treeNode.children, depth + 1);
    });
  };

  sortTree(roots);
  assignDepth(roots);
  return roots;
}

export function toProjectTreeMoveNode(node: ProjectTreeNode): ProjectTreeMoveNode {
  if (node.nodeType === 'folder') {
    return {
      currentParentFolderId: node.parentFolderId || null,
      id: node.id,
      title: node.title,
      type: 'folder',
    };
  }

  return {
    currentParentFolderId: node.projectFolderId || null,
    id: node.id,
    title: node.title,
    type: 'deliverable',
  };
}

export function buildProjectFolderOptions(folders: ProjectFolderItem[]) {
  const folderMap = new Map<
    string,
    ProjectFolderItem & {
      children: Array<ProjectFolderItem & { children: unknown[]; depth: number }>;
      depth: number;
    }
  >();
  const roots: Array<ProjectFolderItem & { children: unknown[]; depth: number }> = [];

  folders.forEach((folder) => {
    folderMap.set(folder.id, {
      ...folder,
      children: [],
      depth: 0,
    });
  });

  folderMap.forEach((folder) => {
    if (folder.parentFolderId) {
      const parent = folderMap.get(folder.parentFolderId);
      if (parent) {
        parent.children.push(folder);
        return;
      }
    }

    roots.push(folder);
  });

  const sortTree = (
    nodes: Array<ProjectFolderItem & { children: unknown[]; depth: number }>
  ) => {
    nodes.sort(compareProjectTreeItems);
    nodes.forEach((node) =>
      sortTree(
        node.children as Array<ProjectFolderItem & { children: unknown[]; depth: number }>
      )
    );
  };

  const flatten = (
    nodes: Array<ProjectFolderItem & { children: unknown[]; depth: number }>,
    depth = 0
  ): Array<ProjectFolderItem & { depth: number }> =>
    nodes.flatMap((node) => [
      {
        id: node.id,
        parentFolderId: node.parentFolderId,
        projectId: node.projectId,
        sortOrder: node.sortOrder,
        title: node.title,
        updatedAt: node.updatedAt,
        depth,
      },
      ...flatten(
        node.children as Array<ProjectFolderItem & { children: unknown[]; depth: number }>,
        depth + 1
      ),
    ]);

  sortTree(roots);
  return flatten(roots);
}

export function compareProjectTreeItems(
  left: { id: string; sortOrder: number; updatedAt: Date | string },
  right: { id: string; sortOrder: number; updatedAt: Date | string }
) {
  if (left.sortOrder === right.sortOrder) {
    const updatedAtDiff =
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (updatedAtDiff !== 0) {
      return updatedAtDiff;
    }

    return left.id.localeCompare(right.id);
  }

  return left.sortOrder - right.sortOrder;
}

export function collectProjectFolderDescendantIds(
  folders: ProjectFolderItem[],
  folderId: string
) {
  const descendants = new Set<string>();
  const childrenByParent = new Map<string | null, string[]>();

  folders.forEach((folder) => {
    const siblings = childrenByParent.get(folder.parentFolderId || null) || [];
    siblings.push(folder.id);
    childrenByParent.set(folder.parentFolderId || null, siblings);
  });

  const visit = (parentId: string) => {
    const children = childrenByParent.get(parentId) || [];
    children.forEach((childId) => {
      if (descendants.has(childId)) {
        return;
      }

      descendants.add(childId);
      visit(childId);
    });
  };

  visit(folderId);
  return descendants;
}
