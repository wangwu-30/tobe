'use client';

import { FolderClosed, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarInfo, SidebarSection } from '@/components/layout/sidebar-primitives';
import type { useT } from '@/components/providers/language-provider';
import { cn } from '@/lib/utils';
import { formatProjectListMeta } from '@/lib/workspace/project-summary';
import type { ProjectMountData, ProjectSummaryData } from '@/types';
import type { DeliverableOutlineItem } from './deliverable-sidebar';

export function SidebarOutlineSection({
  onOpenOutline,
  outlineItems,
  t,
}: {
  onOpenOutline?: (outlineId: string) => void;
  outlineItems: DeliverableOutlineItem[];
  t: ReturnType<typeof useT>;
}) {
  const outlineInteractive = Boolean(onOpenOutline);

  return (
    <SidebarSection
      testId="sidebar-outline-section"
      title={t('sidebar.deliverableOutline')}
    >
      {outlineItems.length === 0 ? (
        <SidebarInfo text={t('sidebar.outlineEmpty')} />
      ) : (
        <div className="min-w-0 space-y-1 overflow-hidden">
          {outlineItems.map((item) =>
            outlineInteractive ? (
              <button
                key={item.id}
                type="button"
                data-testid={`outline-item-${item.id}`}
                onClick={() => onOpenOutline?.(item.id)}
                className={cn(
                  'flex w-full touch-manipulation items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none',
                  item.active && 'bg-background shadow-sm ring-1 ring-border'
                )}
                style={{ paddingLeft: `${item.depth * 14 + 8}px` }}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.label}</span>
              </button>
            ) : (
              <div
                key={item.id}
                className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm text-foreground"
                style={{ paddingLeft: `${item.depth * 14 + 8}px` }}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.label}</span>
              </div>
            )
          )}
        </div>
      )}
    </SidebarSection>
  );
}

export function SidebarLinkedProjectsSection({
  isLoadingMounts,
  mountError,
  mountedProjectItems,
  onOpenMountDialog,
  onOpenProject,
  t,
}: {
  isLoadingMounts: boolean;
  mountError: string | null;
  mountedProjectItems: Array<{
    mount: ProjectMountData;
    targetProject: ProjectSummaryData | null;
    title: string;
  }>;
  onOpenMountDialog: () => void;
  onOpenProject: (project: ProjectSummaryData) => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <SidebarSection
      testId="sidebar-linked-projects-section"
      title={t('sidebar.linkedProjects')}
      action={
        <Button
          aria-label={t('sidebar.addLinkedProject')}
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={onOpenMountDialog}
          data-testid="sidebar-linked-project-dialog-trigger"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      }
    >
      {mountError ? (
        <div className="mb-2 rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {mountError}
        </div>
      ) : null}
      {isLoadingMounts ? (
        <SidebarInfo text={t('sidebar.loadingLinkedProjects')} />
      ) : mountedProjectItems.length === 0 ? (
        <div data-testid="sidebar-linked-projects-empty">
          <SidebarInfo text={t('sidebar.noLinkedProjectsYet')} />
        </div>
      ) : (
        <div className="space-y-2" data-testid="sidebar-linked-projects-list">
          {mountedProjectItems.map(({ mount, targetProject, title }) => (
            <div
              key={mount.id}
              className="rounded-2xl border border-border/70 bg-background/80 px-3 py-2.5"
              data-testid={`sidebar-linked-project-${mount.targetProjectId}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-medium">{title}</div>
                    <Badge
                      variant="secondary"
                      className="rounded-full px-2 py-0 text-[10px] uppercase tracking-[0.12em]"
                    >
                      {t('sidebar.linkedProjectBadge')}
                    </Badge>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {targetProject
                      ? formatProjectListMeta(targetProject, t)
                      : t('sidebar.linkedProjectReferenceOnly')}
                  </div>
                </div>
                {targetProject ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 rounded-lg px-2 text-xs"
                    onClick={() => onOpenProject(targetProject)}
                    data-testid={`sidebar-linked-project-open-${mount.targetProjectId}`}
                  >
                    {t('sidebar.openLinkedProject')}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </SidebarSection>
  );
}

export function SidebarProjectsListSection({
  currentProjectId,
  currentWorkspaceId,
  currentWorkspaceStatusLabel,
  isLoading,
  onCreateWorkspace,
  onDeleteProject,
  onOpenProject,
  onOpenProjectNextDeliverable,
  onOpenRenameDialog,
  projects,
  showEmptyProjectState,
  t,
}: {
  currentProjectId?: string | null;
  currentWorkspaceId?: string | null;
  currentWorkspaceStatusLabel?: string | null;
  isLoading: boolean;
  onCreateWorkspace?: () => void;
  onDeleteProject: (projectId: string) => void;
  onOpenProject: (project: ProjectSummaryData) => void;
  onOpenProjectNextDeliverable: (project: ProjectSummaryData) => void;
  onOpenRenameDialog: (project: ProjectSummaryData) => void;
  projects: ProjectSummaryData[];
  showEmptyProjectState: boolean;
  t: ReturnType<typeof useT>;
}) {
  return (
    <SidebarSection
      testId="sidebar-projects-section"
      title={t('sidebar.projects')}
      action={
        <Button
          aria-label={t('sidebar.newProject')}
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={onCreateWorkspace}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      }
    >
      {isLoading ? (
        <SidebarInfo text={t('sidebar.loadingProjects')} />
      ) : projects.length === 0 && showEmptyProjectState ? (
        <SidebarInfo text={t('sidebar.noProjectsYet')} />
      ) : (
        <div className="min-w-0 space-y-1">
          {projects.map((project) => (
            <div
              key={project.id}
              className={cn(
                'group flex min-w-0 items-center gap-1 overflow-hidden rounded-xl pr-1 transition-colors hover:bg-accent',
                currentProjectId === project.id ? 'bg-background shadow-sm ring-1 ring-border' : ''
              )}
            >
              <button
                type="button"
                className="flex min-w-0 w-full flex-1 touch-manipulation items-center gap-2 overflow-hidden rounded-xl px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => onOpenProject(project)}
                data-testid={`sidebar-project-open-${project.id}`}
              >
                <div className="shrink-0 rounded-md bg-foreground/5 p-1.5 ring-1 ring-border/30">
                  <FolderClosed className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="truncate text-sm font-medium leading-5">{project.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {!currentWorkspaceId
                      ? `${t('sidebar.continueCurrentDeliverable')} · ${formatProjectListMeta(project, t)}`
                      : currentProjectId === project.id && currentWorkspaceStatusLabel
                        ? currentWorkspaceStatusLabel
                        : formatProjectListMeta(project, t)}
                  </div>
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1 pl-1">
                {!currentWorkspaceId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg px-2 text-xs"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenProjectNextDeliverable(project);
                    }}
                    data-testid={`sidebar-project-create-next-${project.id}`}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t('sidebar.newSiblingDeliverable')}
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label={`${t('sidebar.renameProject')}: ${project.title}`}
                      size="icon"
                      variant="ghost"
                      className={cn(
                        'h-7 w-7 shrink-0 data-[state=open]:opacity-100',
                        !currentWorkspaceId &&
                          'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'
                      )}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onOpenRenameDialog(project)}>
                      <Pencil className="h-3.5 w-3.5" />
                      {t('sidebar.renameProject')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => onDeleteProject(project.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('sidebar.deleteProject')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}
    </SidebarSection>
  );
}
