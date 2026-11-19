'use client';

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  FilePlus2,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/components/providers/language-provider';
import { cn } from '@/lib/utils';
import { getWorkspaceFileDisplayName } from '@/lib/workspace/file-presentation';
import type { WorkspaceFileData, WorkspaceVersionFileData } from '@/types';

export type SidebarSupportFile = WorkspaceFileData | WorkspaceVersionFileData;

export type SupportTreeMoveNode = {
  currentParentId: string | null;
  id: string;
  name: string;
  nodeType: 'file' | 'folder';
  path: string;
};

export type WorkspaceFileTreeNode = SidebarSupportFile & {
  children: WorkspaceFileTreeNode[];
  depth: number;
};

export function SupportMaterialTree({
  activeSupportFileId,
  dragNode,
  dropTargetParentId,
  files,
  onCreateSupportFile,
  onCreateSupportFolder,
  onDeleteSupportFile,
  onDragEndNode,
  onDragStartNode,
  onDropNodeOnFolder,
  onDropNodeOnRoot,
  onMoveSupportFile,
  onOpenSupportFile,
  onReorderSupportFile,
  onRenameSupportFile,
  onSetDropTargetParentId,
}: {
  activeSupportFileId?: string | null;
  dragNode?: SupportTreeMoveNode | null;
  dropTargetParentId?: string | null;
  files: WorkspaceFileTreeNode[];
  onCreateSupportFile?: (parentId?: string | null) => Promise<void> | void;
  onCreateSupportFolder?: (parentId?: string | null) => Promise<void> | void;
  onDeleteSupportFile?: (fileId: string) => Promise<void> | void;
  onDragEndNode?: () => void;
  onDragStartNode?: (node: SupportTreeMoveNode) => void;
  onDropNodeOnFolder?: (parentId: string, sortOrder?: number) => Promise<void> | void;
  onDropNodeOnRoot?: (sortOrder?: number) => Promise<void> | void;
  onMoveSupportFile?: (file: SidebarSupportFile) => void;
  onOpenSupportFile?: (fileId: string) => void;
  onReorderSupportFile?: (fileId: string, direction: 'up' | 'down') => void;
  onRenameSupportFile?: (file: SidebarSupportFile) => void;
  onSetDropTargetParentId?: (parentId: string | null) => void;
}) {
  const t = useT();
  return (
    <div className="min-w-0 space-y-1 overflow-hidden">
      {dragNode ? (
        <div
          className={cn(
            'rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground transition-colors',
            dropTargetParentId === null && 'border-primary/60 bg-primary/5 text-foreground'
          )}
          onDragOver={(event) => {
            event.preventDefault();
            onSetDropTargetParentId?.(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void onDropNodeOnRoot?.(files.length);
          }}
        >
          {t('sidebar.moveToRoot')}
        </div>
      ) : null}
      {files.map((file) => (
        <SupportMaterialTreeNode
          key={file.id}
          activeSupportFileId={activeSupportFileId}
          dragNode={dragNode}
          dropTargetParentId={dropTargetParentId}
          file={file}
          siblingCount={files.length}
          siblingIndex={files.findIndex((item) => item.id === file.id)}
          onCreateSupportFile={onCreateSupportFile}
          onCreateSupportFolder={onCreateSupportFolder}
          onDeleteSupportFile={onDeleteSupportFile}
          onDragEndNode={onDragEndNode}
          onDragStartNode={onDragStartNode}
          onDropNodeOnFolder={onDropNodeOnFolder}
          onMoveSupportFile={onMoveSupportFile}
          onOpenSupportFile={onOpenSupportFile}
          onReorderSupportFile={onReorderSupportFile}
          onRenameSupportFile={onRenameSupportFile}
          onSetDropTargetParentId={onSetDropTargetParentId}
        />
      ))}
    </div>
  );
}

function SupportMaterialTreeNode({
  activeSupportFileId,
  dragNode,
  dropTargetParentId,
  file,
  siblingCount,
  siblingIndex,
  onCreateSupportFile,
  onCreateSupportFolder,
  onDeleteSupportFile,
  onDragEndNode,
  onDragStartNode,
  onDropNodeOnFolder,
  onMoveSupportFile,
  onOpenSupportFile,
  onReorderSupportFile,
  onRenameSupportFile,
  onSetDropTargetParentId,
}: {
  activeSupportFileId?: string | null;
  dragNode?: SupportTreeMoveNode | null;
  dropTargetParentId?: string | null;
  file: WorkspaceFileTreeNode;
  siblingCount: number;
  siblingIndex: number;
  onCreateSupportFile?: (parentId?: string | null) => Promise<void> | void;
  onCreateSupportFolder?: (parentId?: string | null) => Promise<void> | void;
  onDeleteSupportFile?: (fileId: string) => Promise<void> | void;
  onDragEndNode?: () => void;
  onDragStartNode?: (node: SupportTreeMoveNode) => void;
  onDropNodeOnFolder?: (parentId: string, sortOrder?: number) => Promise<void> | void;
  onMoveSupportFile?: (file: SidebarSupportFile) => void;
  onOpenSupportFile?: (fileId: string) => void;
  onReorderSupportFile?: (fileId: string, direction: 'up' | 'down') => void;
  onRenameSupportFile?: (file: SidebarSupportFile) => void;
  onSetDropTargetParentId?: (parentId: string | null) => void;
}) {
  const t = useT();
  const isFolder = file.nodeType === 'folder';
  const hasActiveDescendant = containsWorkspaceFileId(file, activeSupportFileId);
  const [open, setOpen] = React.useState(true);
  const isDropTarget = Boolean(isFolder && dragNode && dropTargetParentId === file.id);
  const canMoveUp = siblingIndex > 0;
  const canMoveDown = siblingIndex < siblingCount - 1;

  return (
    <div className="min-w-0 overflow-hidden">
      <div
        className={cn(
          'group flex min-w-0 items-center gap-2 overflow-hidden rounded-xl px-2 py-1.5 transition-colors hover:bg-accent',
          !isFolder && activeSupportFileId === file.id
            ? 'bg-background shadow-sm ring-1 ring-border'
            : isFolder && hasActiveDescendant
              ? 'bg-background/70 ring-1 ring-border/60'
              : '',
          isDropTarget && 'bg-primary/5 ring-1 ring-primary/40'
        )}
        style={{ paddingLeft: `${file.depth * 16 + 8}px` }}
        draggable={Boolean(onDragStartNode)}
        onDragEnd={() => onDragEndNode?.()}
        onDragStart={(event) => {
          if (!onDragStartNode) {
            return;
          }

          event.dataTransfer.effectAllowed = 'move';
          onDragStartNode({
            currentParentId: file.parentId || null,
            id: file.id,
            name: getWorkspaceFileDisplayName(file),
            nodeType: file.nodeType,
            path: file.path,
          });
        }}
        onDragOver={(event) => {
          if (!isFolder || !dragNode) {
            return;
          }

          event.preventDefault();
          onSetDropTargetParentId?.(file.id);
          setOpen(true);
        }}
        onDrop={(event) => {
          if (!isFolder) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          void onDropNodeOnFolder?.(file.id, file.children.length);
        }}
      >
        <button
          type="button"
          data-testid={`support-tree-node-${file.id}`}
          className="flex min-w-0 flex-1 touch-manipulation items-center gap-2 overflow-hidden rounded-md text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => {
            if (isFolder) {
              setOpen((value) => !value);
              return;
            }

            onOpenSupportFile?.(file.id);
          }}
        >
          {isFolder ? (
            open ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{getWorkspaceFileDisplayName(file)}</span>
        </button>

        {onCreateSupportFile ||
        onCreateSupportFolder ||
        onMoveSupportFile ||
        onReorderSupportFile ||
        onRenameSupportFile ||
        onDeleteSupportFile ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`${t('sidebar.uploads')}: ${getWorkspaceFileDisplayName(file)}`}
                size="icon-xs"
                variant="ghost"
                className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                data-testid={`support-tree-actions-${file.id}`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isFolder && onCreateSupportFile ? (
                <DropdownMenuItem onSelect={() => void onCreateSupportFile(file.id)}>
                  <FilePlus2 className="h-3.5 w-3.5" />
                  {t('sidebar.newSupportNote')}
                </DropdownMenuItem>
              ) : null}
              {isFolder && onCreateSupportFolder ? (
                <DropdownMenuItem onSelect={() => void onCreateSupportFolder(file.id)}>
                  <FolderPlus className="h-3.5 w-3.5" />
                  {t('sidebar.newSupportFolder')}
                </DropdownMenuItem>
              ) : null}
              {onReorderSupportFile ? (
                <DropdownMenuItem
                  disabled={!canMoveUp}
                  onSelect={() => onReorderSupportFile(file.id, 'up')}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  {t('sidebar.moveUp')}
                </DropdownMenuItem>
              ) : null}
              {onReorderSupportFile ? (
                <DropdownMenuItem
                  disabled={!canMoveDown}
                  onSelect={() => onReorderSupportFile(file.id, 'down')}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  {t('sidebar.moveDown')}
                </DropdownMenuItem>
              ) : null}
              {onMoveSupportFile ? (
                <DropdownMenuItem onSelect={() => onMoveSupportFile(file)}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t('sidebar.moveSupportMaterial')}
                </DropdownMenuItem>
              ) : null}
              {onRenameSupportFile ? (
                <DropdownMenuItem onSelect={() => onRenameSupportFile(file)}>
                  <Pencil className="h-3.5 w-3.5" />
                  {t('sidebar.renameSupportMaterial')}
                </DropdownMenuItem>
              ) : null}
              {onDeleteSupportFile ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => void onDeleteSupportFile(file.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('sidebar.deleteSupportMaterial')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {isFolder && open && file.children.length > 0 ? (
        <div className="mt-0.5 min-w-0 space-y-1 overflow-hidden">
          {file.children.map((child) => (
            <SupportMaterialTreeNode
              key={child.id}
              activeSupportFileId={activeSupportFileId}
              dragNode={dragNode}
              dropTargetParentId={dropTargetParentId}
              file={child}
              siblingCount={file.children.length}
              siblingIndex={file.children.findIndex((item) => item.id === child.id)}
              onCreateSupportFile={onCreateSupportFile}
              onCreateSupportFolder={onCreateSupportFolder}
              onDeleteSupportFile={onDeleteSupportFile}
              onDragEndNode={onDragEndNode}
              onDragStartNode={onDragStartNode}
              onDropNodeOnFolder={onDropNodeOnFolder}
              onMoveSupportFile={onMoveSupportFile}
              onOpenSupportFile={onOpenSupportFile}
              onReorderSupportFile={onReorderSupportFile}
              onRenameSupportFile={onRenameSupportFile}
              onSetDropTargetParentId={onSetDropTargetParentId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function buildWorkspaceFolderOptions(files: SidebarSupportFile[]) {
  return files
    .filter((file) => file.nodeType === 'folder')
    .slice()
    .sort((left, right) => {
      if (left.path === right.path) {
        return left.sortOrder - right.sortOrder;
      }
      return left.path.localeCompare(right.path);
    })
    .map((file) => ({
      id: file.id,
      depth: file.path.split('/').length - 1,
      name: getWorkspaceFileDisplayName(file),
      path: file.path,
    }));
}

export function containsWorkspaceFileId(
  file: WorkspaceFileTreeNode,
  activeSupportFileId?: string | null
): boolean {
  if (!activeSupportFileId) {
    return false;
  }

  if (file.id === activeSupportFileId) {
    return true;
  }

  return file.children.some((child) => containsWorkspaceFileId(child, activeSupportFileId));
}

export function buildWorkspaceFileTree(files: SidebarSupportFile[]) {
  const nodeMap = new Map<string, WorkspaceFileTreeNode>();
  const roots: WorkspaceFileTreeNode[] = [];

  files
    .slice()
    .sort((left, right) => {
      if (left.path === right.path) {
        return left.sortOrder - right.sortOrder;
      }
      return left.path.localeCompare(right.path);
    })
    .forEach((file) => {
      nodeMap.set(file.id, {
        ...file,
        children: [],
        depth: 0,
      });
    });

  nodeMap.forEach((node) => {
    if (node.parentId) {
      const parent = nodeMap.get(node.parentId);
      if (parent) {
        node.depth = parent.depth + 1;
        parent.children.push(node);
        return;
      }
    }

    roots.push(node);
  });

  const sortTree = (nodes: WorkspaceFileTreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.sortOrder === right.sortOrder) {
        return left.path.localeCompare(right.path);
      }
      return left.sortOrder - right.sortOrder;
    });
    nodes.forEach((node) => sortTree(node.children));
  };

  sortTree(roots);
  return roots;
}
