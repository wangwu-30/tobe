'use client';

import * as React from 'react';
import {
  FileText,
  FolderClosed,
  MoreHorizontal,
  Plus,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  getSidebarWidthClass,
  SidebarIconButton,
  SidebarInfo,
  SidebarSection,
} from '@/components/layout/sidebar-primitives';
import { useT } from '@/components/providers/language-provider';
import { useAppPathname, useAppRouter } from '@/lib/app-router';
import { formatStableDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { WorkspaceSidebarItem } from '@/types';
import type { WorkspaceFileData } from '@/types';

export type DeliverableOutlineItem = {
  active?: boolean;
  depth: number;
  id: string;
  label: string;
};

export function DeliverableSidebar({
  className,
  collapsed = false,
  currentWorkspaceId,
  onCreateWorkspace,
  onDeleteWorkspace,
  onNavigate,
  onOpenOutline,
  onOpenWorkspace,
  outlineItems,
  supportFiles = [],
}: {
  className?: string;
  collapsed?: boolean;
  currentWorkspaceId?: string | null;
  onCreateWorkspace?: () => void;
  onDeleteWorkspace?: (workspaceId: string) => Promise<void> | void;
  onNavigate?: () => void;
  onOpenOutline?: (outlineId: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
  outlineItems: DeliverableOutlineItem[];
  supportFiles?: WorkspaceFileData[];
}) {
  const t = useT();
  const pathname = useAppPathname();
  const router = useAppRouter();
  const [isLoading, setIsLoading] = React.useState(true);
  const [workspaces, setWorkspaces] = React.useState<WorkspaceSidebarItem[]>([]);

  const loadWorkspaces = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/workspaces');
      if (!res.ok) {
        return;
      }

      const data = await res.json();
      setWorkspaces(data.items || []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  const handleDelete = React.useCallback(
    async (workspaceId: string) => {
      if (!window.confirm(t('sidebar.deleteProjectConfirm'))) {
        return;
      }

      if (onDeleteWorkspace) {
        await onDeleteWorkspace(workspaceId);
      } else {
        const response = await fetch(`/api/workspaces/${workspaceId}`, { method: 'DELETE' });
        if (!response.ok) {
          return;
        }
        if (workspaceId === currentWorkspaceId) {
          router.push('/');
        }
      }
      await loadWorkspaces();
    },
    [currentWorkspaceId, loadWorkspaces, onDeleteWorkspace, router, t]
  );

  const openWorkspace = React.useCallback(
    (workspaceId: string) => {
      onNavigate?.();
      if (onOpenWorkspace) {
        onOpenWorkspace(workspaceId);
        return;
      }
      router.push(`/workspace/${workspaceId}`);
    },
    [onNavigate, onOpenWorkspace, router]
  );

  return (
    <aside
      className={cn(
        'h-full shrink-0 overflow-hidden border-r border-border bg-muted/25 transition-[width] duration-200 ease-out',
        getSidebarWidthClass(collapsed),
        className
      )}
    >
      <div className="flex h-full min-w-0 w-full flex-col overflow-hidden">
        <div
          className={cn(
            'min-w-0 w-full overflow-hidden border-b border-border',
            collapsed ? 'px-2 py-3' : 'px-3 py-3'
          )}
        >
          <button
            className={cn(
              'flex max-w-full items-center rounded-xl text-left transition-colors hover:bg-accent',
              collapsed
                ? 'mx-auto h-11 w-11 justify-center px-0 py-0'
                : 'w-full min-w-0 gap-2 px-2 py-2'
            )}
            onClick={() => {
              onNavigate?.();
              router.push('/');
            }}
            type="button"
          >
            <div className="rounded-lg bg-background p-2 shadow-sm">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            {!collapsed ? (
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="truncate text-sm font-semibold">成形</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t('sidebar.aiNativeStudio')}
                </div>
              </div>
            ) : null}
          </button>

          {collapsed ? (
            <SidebarIconButton
              className="mt-3"
              icon={<Plus className="h-4 w-4" />}
              label={t('sidebar.newProject')}
              onClick={() => onCreateWorkspace?.()}
            />
          ) : (
            <Button
              className="mt-3 w-full min-w-0 max-w-full justify-start gap-2 overflow-hidden rounded-xl"
              onClick={onCreateWorkspace}
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('sidebar.newProject')}</span>
            </Button>
          )}
        </div>

        <ScrollArea className="min-h-0 w-full flex-1 overflow-hidden">
          {collapsed ? (
            <div className="flex min-w-0 flex-col items-center gap-2 px-2 py-3">
              {isLoading ? (
                <SidebarInfo compact text="..." />
              ) : workspaces.length === 0 ? (
                <SidebarInfo compact text="-" />
              ) : (
                workspaces.map((workspace) => (
                  <SidebarIconButton
                    key={workspace.id}
                    active={currentWorkspaceId === workspace.id}
                    icon={<FolderClosed className="h-4 w-4" />}
                    label={workspace.title}
                    onClick={() => openWorkspace(workspace.id)}
                  />
                ))
              )}
            </div>
          ) : (
            <div className="min-w-0 space-y-4 px-2 py-3">
              <SidebarSection
                title={t('sidebar.projects')}
                action={
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onCreateWorkspace}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                }
              >
                {isLoading ? (
                  <SidebarInfo text={t('sidebar.loadingProjects')} />
                ) : workspaces.length === 0 ? (
                  <SidebarInfo text={t('sidebar.noProjectsYet')} />
                ) : (
                  <div className="min-w-0 space-y-1">
                    {workspaces.map((workspace) => (
                      <div
                        key={workspace.id}
                        className={cn(
                          'group flex min-w-0 items-center gap-2 overflow-hidden rounded-xl px-2 py-1.5 transition-colors hover:bg-accent',
                          currentWorkspaceId === workspace.id
                            ? 'bg-background shadow-sm ring-1 ring-border'
                            : ''
                        )}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left"
                          onClick={() => openWorkspace(workspace.id)}
                        >
                          <div className="rounded-md bg-background/80 p-1.5 ring-1 ring-border/60">
                            <FolderClosed className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate text-sm font-medium leading-5">{workspace.title}</div>
                            <div className="truncate text-[11px] text-muted-foreground/80">
                              {formatStableDate(workspace.updatedAt)}
                            </div>
                          </div>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => void handleDelete(workspace.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t('sidebar.deleteProject')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                )}
              </SidebarSection>

              <SidebarSection title={t('sidebar.deliverableOutline')}>
                {outlineItems.length === 0 ? (
                  <SidebarInfo text={t('sidebar.outlineEmpty')} />
                ) : (
                  <div className="min-w-0 space-y-1 overflow-hidden">
                    {outlineItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onOpenOutline?.(item.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                          item.active && 'bg-background shadow-sm ring-1 ring-border'
                        )}
                        style={{ paddingLeft: `${item.depth * 14 + 8}px` }}
                      >
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </SidebarSection>

              <SidebarSection title={t('sidebar.uploads')}>
                {supportFiles.length === 0 ? (
                  <SidebarInfo text={t('sidebar.noUploadsYet')} />
                ) : (
                  <div className="min-w-0 space-y-1 overflow-hidden">
                    {supportFiles
                      .filter((file) => file.nodeType === 'file')
                      .slice(0, 8)
                      .map((file) => (
                        <div
                          key={file.id}
                          className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm"
                        >
                          <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{file.name}</span>
                        </div>
                      ))}
                  </div>
                )}
              </SidebarSection>
            </div>
          )}
        </ScrollArea>

        <div
          className={cn(
            'min-w-0 w-full overflow-hidden border-t border-border',
            collapsed ? 'px-2 py-3' : 'p-3'
          )}
        >
          {collapsed ? (
            <SidebarIconButton
              active={pathname === '/settings'}
              icon={<Settings className="h-4 w-4" />}
              label={t('common.settings')}
              onClick={() => {
                onNavigate?.();
                router.push('/settings');
              }}
            />
          ) : (
            <Button
              variant={pathname === '/settings' ? 'secondary' : 'ghost'}
              className="w-full min-w-0 max-w-full justify-start gap-2 overflow-hidden rounded-xl"
              onClick={() => {
                onNavigate?.();
                router.push('/settings');
              }}
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('common.settings')}</span>
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
