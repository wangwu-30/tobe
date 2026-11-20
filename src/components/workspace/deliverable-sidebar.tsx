'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  FilePlus2,
  FileText,
  FolderClosed,
  FolderPlus,
  List,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import { AdvancedNavigation } from '@/components/layout/advanced-navigation';
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
import { SidebarSearch } from '@/components/layout/sidebar-search';
import { useT } from '@/components/providers/language-provider';
import { useAppRouter } from '@/lib/app-router';
import { useGuardedRouter } from '@/lib/navigation/navigation-guard';
import { cn } from '@/lib/utils';
import { buildWorkspaceRoute } from '@/lib/workspace/route';
import {
  formatProjectDeliverableCount,
  listProjectFolderPath,
} from '@/lib/workspace/project-summary';
import {
  createWorkspaceProjectMount,
  listWorkspaceProjectMounts,
} from '@/lib/workspace/project-client';
import type {
  ProjectDeliverableItem,
  ProjectFolderItem,
  ProjectMountData,
  ProjectSummaryData,
} from '@/types';
import { apiFetch } from '@/framework/resilience';
import { ProjectDeliverableTree } from './project-deliverable-tree';
import { SupportMaterialTree, type SidebarSupportFile } from './support-material-tree';
import { DeliverableSidebarDialogs } from './deliverable-sidebar-dialogs';
import {
  SidebarLinkedProjectsSection,
  SidebarOutlineSection,
  SidebarProjectsListSection,
} from './deliverable-sidebar-sections';
import {
  PROJECT_TREE_ROOT_VALUE,
  useProjectTreeActions,
} from './use-project-tree-actions';
import {
  SUPPORT_TREE_ROOT_VALUE,
  useSupportTreeActions,
} from './use-support-tree-actions';

export type DeliverableOutlineItem = {
  active?: boolean;
  depth: number;
  id: string;
  label: string;
};

export function DeliverableSidebar({
  activeSupportFileId,
  className,
  collapsed = false,
  currentProjectId,
  currentProjectTitle,
  currentWorkspaceId,
  currentWorkspaceStatusLabel,
  onCreateWorkspace,
  onCreateDeliverable,
  onCreateProjectFolder,
  onCreateSiblingDeliverable,
  onCreateSupportFile,
  onCreateSupportFolder,
  onDeleteDeliverable,
  onDeleteProjectFolder,
  onDeleteWorkspace,
  onDeleteSupportFile,
  onMoveDeliverable,
  onMoveProjectFolder,
  onMoveSupportFile,
  onNavigate,
  onOpenOutline,
  onOpenDeliverable,
  onReorderDeliverable,
  onReorderProjectFolder,
  onReorderSupportFile,
  onRenameDeliverable,
  onRenameProjectFolder,
  onRenameSupportFile,
  onRenameWorkspace,
  onOpenSupportFile,
  onOpenWorkspace,
  onProjectsChange,
  onRequestExpand,
  outlineItems,
  projectFolders = [],
  projectDeliverables = [],
  showEmptyProjectState = true,
  supportFiles = [],
}: {
  activeSupportFileId?: string | null;
  className?: string;
  collapsed?: boolean;
  currentProjectId?: string | null;
  currentProjectTitle?: string | null;
  currentWorkspaceId?: string | null;
  currentWorkspaceStatusLabel?: string | null;
  onCreateWorkspace?: () => void;
  onCreateDeliverable?: (context?: {
    projectFolderId?: string | null;
  }) => Promise<void> | void;
  onCreateProjectFolder?: (parentFolderId?: string | null) => Promise<void> | void;
  onCreateSiblingDeliverable?: (workspaceId: string) => Promise<void> | void;
  onDeleteDeliverable?: (workspaceId: string) => Promise<void> | void;
  onCreateSupportFile?: (parentId?: string | null) => Promise<void> | void;
  onCreateSupportFolder?: (parentId?: string | null) => Promise<void> | void;
  onDeleteProjectFolder?: (folderId: string) => Promise<void> | void;
  onDeleteWorkspace?: (workspaceId: string) => Promise<void> | void;
  onDeleteSupportFile?: (fileId: string) => Promise<void> | void;
  onMoveDeliverable?: (workspaceId: string, projectFolderId: string | null) => Promise<void> | void;
  onMoveProjectFolder?: (folderId: string, parentFolderId: string | null) => Promise<void> | void;
  onMoveSupportFile?: (
    fileId: string,
    parentId: string | null,
    sortOrder?: number
  ) => Promise<void> | void;
  onNavigate?: () => void;
  onOpenDeliverable?: (workspaceId: string) => void;
  onOpenOutline?: (outlineId: string) => void;
  onReorderDeliverable?: (
    workspaceId: string,
    direction: 'up' | 'down'
  ) => Promise<void> | void;
  onReorderProjectFolder?: (
    folderId: string,
    direction: 'up' | 'down'
  ) => Promise<void> | void;
  onReorderSupportFile?: (
    fileId: string,
    direction: 'up' | 'down'
  ) => Promise<void> | void;
  onRenameDeliverable?: (workspaceId: string, title: string) => Promise<void> | void;
  onRenameProjectFolder?: (folderId: string, title: string) => Promise<void> | void;
  onRenameSupportFile?: (fileId: string, name: string) => Promise<void> | void;
  onRenameWorkspace?: (workspaceId: string, title: string) => Promise<void> | void;
  onOpenSupportFile?: (fileId: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
  onProjectsChange?: (projects: ProjectSummaryData[]) => void;
  onRequestExpand?: () => void;
  outlineItems: DeliverableOutlineItem[];
  projectFolders?: ProjectFolderItem[];
  projectDeliverables?: ProjectDeliverableItem[];
  showEmptyProjectState?: boolean;
  supportFiles?: SidebarSupportFile[];
}) {
  const t = useT();
  const router = useAppRouter();
  const guardedRouter = useGuardedRouter();
  const sidebarRootRef = React.useRef<HTMLElement | null>(null);
  const [pendingExpandSection, setPendingExpandSection] = React.useState<
    'outline' | 'projects' | 'search' | 'tree' | null
  >(null);
  const requestExpandSection = React.useCallback(
    (section: 'outline' | 'projects' | 'search' | 'tree') => {
      setPendingExpandSection(section);
      onRequestExpand?.();
    },
    [onRequestExpand]
  );

  React.useEffect(() => {
    if (collapsed || !pendingExpandSection) {
      return;
    }

    const testIdBySection: Record<'outline' | 'projects' | 'search' | 'tree', string> = {
      outline: 'sidebar-outline-section',
      projects: 'sidebar-projects-section',
      search: 'sidebar-node-search-section',
      tree: 'sidebar-project-tree-section',
    };
    const sectionTestId = testIdBySection[pendingExpandSection];
    const targetSection = sidebarRootRef.current?.querySelector<HTMLElement>(
      `[data-testid="${sectionTestId}"]`
    );

    if (targetSection) {
      targetSection.scrollIntoView({ behavior: 'auto', block: 'start' });
      if (pendingExpandSection === 'search') {
        targetSection.querySelector<HTMLInputElement>('input')?.focus();
      }
    }

    setPendingExpandSection(null);
  }, [collapsed, pendingExpandSection]);

  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingMounts, setIsLoadingMounts] = React.useState(false);
  const [projects, setProjects] = React.useState<ProjectSummaryData[]>([]);
  const [projectMounts, setProjectMounts] = React.useState<ProjectMountData[]>([]);
  const [renameWorkspaceId, setRenameWorkspaceId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [isRenamingWorkspace, setIsRenamingWorkspace] = React.useState(false);
  const [mountError, setMountError] = React.useState<string | null>(null);
  const [isMountDialogOpen, setIsMountDialogOpen] = React.useState(false);
  const [selectedMountTargetProjectId, setSelectedMountTargetProjectId] = React.useState('');
  const [mountDialogError, setMountDialogError] = React.useState<string | null>(null);
  const [isCreatingMount, setIsCreatingMount] = React.useState(false);

  const loadProjects = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/project-list');
      if (!res.ok) {
        return;
      }

      const data = await res.json();
      const nextProjects = data.items || [];
      setProjects(nextProjects);
      onProjectsChange?.(nextProjects);
    } finally {
      setIsLoading(false);
    }
  }, [onProjectsChange]);

  React.useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const projectTreeActions = useProjectTreeActions({
    loadProjects,
    onDeleteDeliverable,
    onDeleteProjectFolder,
    onMoveDeliverable,
    onMoveProjectFolder,
    onRenameDeliverable,
    onRenameProjectFolder,
    onReorderDeliverable,
    onReorderProjectFolder,
    projectDeliverables,
    projectFolders,
    t,
  });

  const supportTreeActions = useSupportTreeActions({
    currentWorkspaceId,
    onDeleteSupportFile,
    onMoveSupportFile,
    onRenameSupportFile,
    onReorderSupportFile,
    supportFiles,
    t,
  });

  const activeProject = React.useMemo(
    () => projects.find((project) => project.id === currentProjectId) || null,
    [currentProjectId, projects]
  );
  const mountedProjectItems = React.useMemo(
    () =>
      projectMounts.map((mount) => {
        const targetProject = projects.find((project) => project.id === mount.targetProjectId) || null;
        return {
          mount,
          targetProject,
          title:
            mount.targetProjectTitle?.trim() || targetProject?.title?.trim() || mount.targetProjectId,
        };
      }),
    [projectMounts, projects]
  );
  const availableMountProjects = React.useMemo(() => {
    const mountedProjectIds = new Set(projectMounts.map((mount) => mount.targetProjectId));
    return projects.filter(
      (project) => project.id !== currentProjectId && !mountedProjectIds.has(project.id)
    );
  }, [currentProjectId, projectMounts, projects]);
  const currentProjectContextTitle = React.useMemo(() => {
    const explicitTitle = currentProjectTitle?.trim() || null;
    if (explicitTitle) {
      return explicitTitle;
    }

    return activeProject?.title?.trim() || null;
  }, [activeProject?.title, currentProjectTitle]);
  const currentProjectDeliverable = React.useMemo(
    () =>
      currentWorkspaceId
        ? projectTreeActions.projectDeliverablesById.get(currentWorkspaceId) || null
        : null,
    [currentWorkspaceId, projectTreeActions.projectDeliverablesById]
  );
  const currentProjectDeliverablePath = React.useMemo(() => {
    if (!currentProjectContextTitle || !currentProjectDeliverable) {
      return null;
    }

    const folderSegments = listProjectFolderPath(
      currentProjectDeliverable.projectFolderId,
      projectFolders
    );

    return [currentProjectContextTitle, ...folderSegments].filter(Boolean).join(' / ');
  }, [currentProjectContextTitle, currentProjectDeliverable, projectFolders]);
  const showCurrentProjectContext = React.useMemo(() => {
    if (!currentProjectContextTitle || !currentProjectDeliverable) {
      return false;
    }

    return (
      projectDeliverables.length > 1 ||
      projectFolders.length > 0 ||
      currentProjectContextTitle !== currentProjectDeliverable.title.trim()
    );
  }, [
    currentProjectContextTitle,
    currentProjectDeliverable,
    projectDeliverables.length,
    projectFolders.length,
  ]);

  const loadMounts = React.useCallback(async () => {
    if (!currentProjectId) {
      setProjectMounts([]);
      setMountError(null);
      setIsLoadingMounts(false);
      return;
    }

    setIsLoadingMounts(true);
    setMountError(null);

    try {
      const mounts = await listWorkspaceProjectMounts({
        errorMessage: t('sidebar.loadLinkedProjectsFailed'),
        projectId: currentProjectId,
      });
      setProjectMounts(mounts);
    } catch (error) {
      setMountError(
        error instanceof Error ? error.message : t('sidebar.loadLinkedProjectsFailed')
      );
    } finally {
      setIsLoadingMounts(false);
    }
  }, [currentProjectId, t]);

  React.useEffect(() => {
    void loadMounts();
  }, [loadMounts]);

  React.useEffect(() => {
    if (!isMountDialogOpen) {
      return;
    }

    if (
      selectedMountTargetProjectId &&
      availableMountProjects.some((project) => project.id === selectedMountTargetProjectId)
    ) {
      return;
    }

    setSelectedMountTargetProjectId(availableMountProjects[0]?.id || '');
  }, [availableMountProjects, isMountDialogOpen, selectedMountTargetProjectId]);

  const handleDelete = React.useCallback(
    async (projectId: string) => {
      if (!window.confirm(t('sidebar.deleteProjectConfirm'))) {
        return;
      }

      if (onDeleteWorkspace) {
        await onDeleteWorkspace(projectId);
      } else {
        const response = await apiFetch(`/api/projects/${projectId}`, { method: 'DELETE' });
        if (!response.ok) {
          return;
        }
        if (projectId === currentProjectId) {
          guardedRouter.push('/', () => router.push('/'));
        }
      }
      await loadProjects();
    },
    [currentProjectId, guardedRouter, loadProjects, onDeleteWorkspace, router, t]
  );

  const openProject = React.useCallback(
    (project: ProjectSummaryData) => {
      const href = buildWorkspaceRoute({
        nodeId: project.workspaceId,
        projectId: project.id,
      });
      if (onOpenWorkspace && project.id === currentProjectId) {
        guardedRouter.push(href, () => {
          onNavigate?.();
          onOpenWorkspace(project.workspaceId);
        });
        return;
      }
      guardedRouter.push(href, () => {
        onNavigate?.();
        router.push(href);
      });
    },
    [currentProjectId, guardedRouter, onNavigate, onOpenWorkspace, router]
  );
  const openProjectNextDeliverable = React.useCallback(
    (project: ProjectSummaryData) => {
      const params = new URLSearchParams({
        newDeliverableProjectId: project.id,
        newDeliverableProjectTitle: project.title,
      });
      const href = `/?${params.toString()}`;
      guardedRouter.push(href, () => {
        onNavigate?.();
        router.push(href);
      });
    },
    [guardedRouter, onNavigate, router]
  );
  const openSupportFile = React.useCallback(
    (fileId: string) => {
      const href = currentWorkspaceId
        ? buildWorkspaceRoute({
            fileId,
            nodeId: currentWorkspaceId,
            projectId: currentProjectId || currentWorkspaceId,
          })
        : null;
      if (onOpenSupportFile) {
        guardedRouter.push(href || window.location.href, () => {
          onNavigate?.();
          onOpenSupportFile(fileId);
        });
        return;
      }
      if (href) {
        guardedRouter.push(href, () => {
          onNavigate?.();
          router.push(href);
        });
      }
    },
    [
      currentProjectId,
      currentWorkspaceId,
      guardedRouter,
      onNavigate,
      onOpenSupportFile,
      router,
    ]
  );
  const openRenameDialog = React.useCallback((project: ProjectSummaryData) => {
    setRenameWorkspaceId(project.id);
    setRenameValue(project.title);
    setRenameError(null);
  }, []);
  const openMountDialog = React.useCallback(() => {
    setIsMountDialogOpen(true);
    setSelectedMountTargetProjectId(availableMountProjects[0]?.id || '');
    setMountDialogError(null);
  }, [availableMountProjects]);
  const closeRenameDialog = React.useCallback(
    (open: boolean) => {
      if (open || isRenamingWorkspace) {
        return;
      }

      setRenameWorkspaceId(null);
      setRenameValue('');
      setRenameError(null);
    },
    [isRenamingWorkspace]
  );
  const closeMountDialog = React.useCallback(
    (open: boolean) => {
      if (open || isCreatingMount) {
        return;
      }

      setIsMountDialogOpen(false);
      setSelectedMountTargetProjectId('');
      setMountDialogError(null);
    },
    [isCreatingMount]
  );
  const handleRename = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!renameWorkspaceId) {
        return;
      }

      const nextTitle = renameValue.trim();
      const currentTitle =
        projects.find((project) => project.id === renameWorkspaceId)?.title.trim() || '';

      if (!nextTitle) {
        setRenameError(t('sidebar.renameProjectRequired'));
        return;
      }

      if (nextTitle === currentTitle) {
        setRenameWorkspaceId(null);
        setRenameValue('');
        setRenameError(null);
        return;
      }

      setIsRenamingWorkspace(true);
      setRenameError(null);

      try {
        if (onRenameWorkspace) {
          await onRenameWorkspace(renameWorkspaceId, nextTitle);
        } else {
          const response = await apiFetch(`/api/projects/${renameWorkspaceId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title: nextTitle }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(payload?.error || t('sidebar.renameProjectFailed'));
          }
        }

        await loadProjects();
        setRenameWorkspaceId(null);
        setRenameValue('');
        setRenameError(null);
      } catch (error) {
        setRenameError(
          error instanceof Error ? error.message : t('sidebar.renameProjectFailed')
        );
      } finally {
        setIsRenamingWorkspace(false);
      }
    },
    [loadProjects, onRenameWorkspace, projects, renameValue, renameWorkspaceId, t]
  );
  const handleCreateMount = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!currentProjectId) {
        return;
      }

      const targetProjectId = selectedMountTargetProjectId.trim();
      if (!targetProjectId) {
        setMountDialogError(t('sidebar.addLinkedProjectRequired'));
        return;
      }

      setIsCreatingMount(true);
      setMountDialogError(null);

      try {
        await createWorkspaceProjectMount({
          errorMessage: t('sidebar.addLinkedProjectFailed'),
          projectId: currentProjectId,
          targetProjectId,
        });
        await loadMounts();
        setIsMountDialogOpen(false);
        setSelectedMountTargetProjectId('');
        setMountDialogError(null);
      } catch (error) {
        setMountDialogError(
          error instanceof Error ? error.message : t('sidebar.addLinkedProjectFailed')
        );
      } finally {
        setIsCreatingMount(false);
      }
    },
    [currentProjectId, loadMounts, selectedMountTargetProjectId, t]
  );

  return (
    <>
      <aside
        ref={sidebarRootRef}
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
            <Link
              aria-label={t('common.home')}
              className={cn(
                'flex max-w-full touch-manipulation items-center rounded-xl text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                collapsed
                  ? 'mx-auto h-11 w-11 justify-center px-0 py-0'
                  : 'w-full min-w-0 gap-2 px-2 py-2'
              )}
              href="/"
              onClick={onNavigate}
            >
              <div className="rounded-lg bg-background p-2 shadow-sm">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              {!collapsed ? (
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="truncate text-sm font-semibold">成形</div>
                  <div className="truncate text-xs text-foreground/60">
                    {t('sidebar.aiNativeStudio')}
                  </div>
                </div>
              ) : null}
            </Link>

            {collapsed ? (
              currentWorkspaceId ? (
                <SidebarIconButton
                  className="mt-3"
                  icon={<FilePlus2 className="h-4 w-4" />}
                  label={t('sidebar.newDeliverable')}
                  onClick={() => onCreateDeliverable?.()}
                  testId="sidebar-collapsed-new-page"
                />
              ) : (
                <SidebarIconButton
                  className="mt-3"
                  icon={<Plus className="h-4 w-4" />}
                  label={t('sidebar.newProject')}
                  onClick={() => onCreateWorkspace?.()}
                  testId="sidebar-collapsed-new-space"
                />
              )
            ) : (
              <Button
                className="mt-3 w-full min-w-0 max-w-full justify-start gap-2 overflow-hidden rounded-xl"
                data-testid={currentWorkspaceId ? 'sidebar-new-page' : undefined}
                disabled={currentWorkspaceId ? !onCreateDeliverable : !onCreateWorkspace}
                onClick={
                  currentWorkspaceId
                    ? () => void onCreateDeliverable?.()
                    : onCreateWorkspace
                }
              >
                {currentWorkspaceId ? (
                  <FilePlus2 className="h-4 w-4 shrink-0" />
                ) : (
                  <Plus className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate">
                  {currentWorkspaceId
                    ? t('sidebar.newDeliverable')
                    : t('sidebar.newProject')}
                </span>
              </Button>
            )}
          </div>

          <ScrollArea
            className="min-h-0 w-full flex-1 overflow-hidden"
            viewportProps={{
              'aria-label': t('sidebar.projectTree'),
              tabIndex: 0,
            }}
          >
            {collapsed ? (
              <div className="flex min-w-0 flex-col items-center gap-2 px-2 py-3">
                {currentWorkspaceId && currentProjectId ? (
                  <SidebarIconButton
                    icon={<Search className="h-4 w-4" />}
                    label={t('sidebar.searchProjectNodes')}
                    onClick={() => requestExpandSection('search')}
                    testId="sidebar-collapsed-search"
                  />
                ) : null}
                {currentWorkspaceId ? (
                  <>
                    <SidebarIconButton
                      icon={<List className="h-4 w-4" />}
                      label={t('sidebar.projectTree')}
                      onClick={() => requestExpandSection('tree')}
                      testId="sidebar-collapsed-tree"
                    />
                    <SidebarIconButton
                      icon={<Sparkles className="h-4 w-4" />}
                      label={t('sidebar.deliverableOutline')}
                      onClick={() => requestExpandSection('outline')}
                      testId="sidebar-collapsed-outline"
                    />
                  </>
                ) : null}
                <SidebarIconButton
                  icon={<FolderClosed className="h-4 w-4" />}
                  label={t('sidebar.projects')}
                  onClick={() => requestExpandSection('projects')}
                  testId="sidebar-collapsed-projects"
                />
              </div>
            ) : (
              <div className="flex min-w-0 flex-col gap-4 px-2 py-3">
                {currentWorkspaceId && currentProjectId ? (
                  <SidebarSection
                    testId="sidebar-node-search-section"
                    title={t('sidebar.searchProjectNodes')}
                  >
                    <SidebarSearch
                      currentNodeId={currentWorkspaceId}
                      onNavigate={onNavigate}
                      projectId={currentProjectId}
                    />
                  </SidebarSection>
                ) : null}

                {currentWorkspaceId ? (
                  <SidebarSection
                    testId="sidebar-project-tree-section"
                    title={t('sidebar.projectTree')}
                    action={
                      onCreateDeliverable || onCreateProjectFolder ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              aria-label={`${t('sidebar.newDeliverable')} / ${t('sidebar.newProjectFolder')}`}
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 shrink-0"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {onCreateDeliverable ? (
                              <DropdownMenuItem
                                onSelect={() =>
                                  void onCreateDeliverable({
                                    projectFolderId: null,
                                  })
                                }
                              >
                                <FilePlus2 className="h-3.5 w-3.5" />
                                {t('sidebar.newDeliverable')}
                              </DropdownMenuItem>
                            ) : null}
                            {onCreateProjectFolder ? (
                              <DropdownMenuItem onSelect={() => void onCreateProjectFolder(null)}>
                                <FolderPlus className="h-3.5 w-3.5" />
                                {t('sidebar.newProjectFolder')}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : undefined
                    }
                  >
                    {showCurrentProjectContext &&
                    currentProjectContextTitle &&
                    currentProjectDeliverable ? (
                      <div
                        className="mb-2 rounded-2xl border border-border/70 bg-background/80 px-3 py-2.5"
                        data-testid="sidebar-current-project-context"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                            {t('sidebar.currentProjectLabel')}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatProjectDeliverableCount(
                              activeProject?.deliverableCount ?? projectDeliverables.length,
                              t
                            )}
                          </div>
                        </div>
                        <div className="mt-1 truncate text-sm font-semibold">
                          {currentProjectContextTitle}
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {t('sidebar.currentDeliverableMeta', {
                            title: currentProjectDeliverable.title,
                          })}
                        </div>
                        {currentProjectDeliverablePath ? (
                          <div className="truncate text-[11px] text-muted-foreground">
                            {currentProjectDeliverablePath}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {projectTreeActions.projectTreeError ? (
                      <div className="mb-2 rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        {projectTreeActions.projectTreeError}
                      </div>
                    ) : null}
                    {projectFolders.length === 0 && projectDeliverables.length === 0 ? (
                      <SidebarInfo text={t('sidebar.noProjectTreeYet')} />
                    ) : (
                      <ProjectDeliverableTree
                        currentWorkspaceId={currentWorkspaceId}
                        dragNode={projectTreeActions.dragNode}
                        folders={projectFolders}
                        deliverables={projectDeliverables}
                        dropTargetFolderId={projectTreeActions.dropTargetFolderId}
                        onCreateDeliverable={onCreateDeliverable}
                        onCreateProjectFolder={onCreateProjectFolder}
                        onCreateSiblingDeliverable={onCreateSiblingDeliverable}
                        onDeleteDeliverable={
                          onDeleteDeliverable
                            ? (targetWorkspaceId) =>
                                void projectTreeActions.handleDeleteDeliverable(targetWorkspaceId)
                            : undefined
                        }
                        onDeleteProjectFolder={
                          onDeleteProjectFolder
                            ? (folderId) =>
                                void projectTreeActions.handleDeleteProjectFolder(folderId)
                            : undefined
                        }
                        onMoveDeliverable={
                          onMoveDeliverable
                            ? projectTreeActions.openMoveDeliverableDialog
                            : undefined
                        }
                        onMoveProjectFolder={
                          onMoveProjectFolder
                            ? projectTreeActions.openMoveProjectFolderDialog
                            : undefined
                        }
                        onOpenDeliverable={onOpenDeliverable || onOpenWorkspace}
                        onReorderDeliverable={
                          onReorderDeliverable
                            ? (node, direction) =>
                                void projectTreeActions.handleReorderProjectTreeNode(
                                  node,
                                  direction
                                )
                            : undefined
                        }
                        onReorderProjectFolder={
                          onReorderProjectFolder
                            ? (node, direction) =>
                                void projectTreeActions.handleReorderProjectTreeNode(
                                  node,
                                  direction
                                )
                            : undefined
                        }
                        onDragEndNode={
                          onMoveDeliverable || onMoveProjectFolder
                            ? projectTreeActions.handleProjectTreeDragEnd
                            : undefined
                        }
                        onDragStartNode={
                          onMoveDeliverable || onMoveProjectFolder
                            ? projectTreeActions.handleProjectTreeDragStart
                            : undefined
                        }
                        onDropNodeOnFolder={
                          onMoveDeliverable || onMoveProjectFolder
                            ? (folderId) => void projectTreeActions.handleProjectTreeDrop(folderId)
                            : undefined
                        }
                        onDropNodeOnRoot={
                          onMoveDeliverable || onMoveProjectFolder
                            ? () => void projectTreeActions.handleProjectTreeDrop(null)
                            : undefined
                        }
                        onSetDropTargetFolderId={
                          onMoveDeliverable || onMoveProjectFolder
                            ? projectTreeActions.setDropTargetFolderId
                            : undefined
                        }
                        onRequestRenameDeliverable={
                          onRenameDeliverable
                            ? projectTreeActions.openRenameDeliverableDialog
                            : undefined
                        }
                        onRequestRenameProjectFolder={
                          onRenameProjectFolder
                            ? projectTreeActions.openRenameProjectFolderDialog
                            : undefined
                        }
                      />
                    )}
                  </SidebarSection>
                ) : null}

                {currentWorkspaceId ? (
                  <SidebarOutlineSection
                    onOpenOutline={onOpenOutline}
                    outlineItems={outlineItems}
                    t={t}
                  />
                ) : null}

                {currentWorkspaceId && currentProjectId ? (
                  <SidebarLinkedProjectsSection
                    isLoadingMounts={isLoadingMounts}
                    mountError={mountError}
                    mountedProjectItems={mountedProjectItems}
                    onOpenMountDialog={openMountDialog}
                    onOpenProject={openProject}
                    t={t}
                  />
                ) : null}

                {currentWorkspaceId ? (
                  <SidebarSection
                    testId="sidebar-support-section"
                    title={t('sidebar.uploads')}
                    action={
                      onCreateSupportFile || onCreateSupportFolder ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              aria-label={`${t('sidebar.newSupportNote')} / ${t('sidebar.newSupportFolder')}`}
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 shrink-0"
                              data-testid="support-tree-add-trigger"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {onCreateSupportFile ? (
                              <DropdownMenuItem onSelect={() => void onCreateSupportFile(null)}>
                                <FilePlus2 className="h-3.5 w-3.5" />
                                {t('sidebar.newSupportNote')}
                              </DropdownMenuItem>
                            ) : null}
                            {onCreateSupportFolder ? (
                              <DropdownMenuItem onSelect={() => void onCreateSupportFolder(null)}>
                                <FolderPlus className="h-3.5 w-3.5" />
                                {t('sidebar.newSupportFolder')}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : undefined
                    }
                  >
                    {supportTreeActions.supportTreeError ? (
                      <div className="mb-2 rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        {supportTreeActions.supportTreeError}
                      </div>
                    ) : null}
                    {supportTreeActions.supportTree.length === 0 ? (
                      <div data-testid="support-tree-empty">
                        <SidebarInfo text={t('sidebar.noUploadsYet')} />
                      </div>
                    ) : (
                      <SupportMaterialTree
                        activeSupportFileId={activeSupportFileId}
                        dragNode={supportTreeActions.dragSupportNode}
                        files={supportTreeActions.supportTree}
                        onCreateSupportFile={onCreateSupportFile}
                        onCreateSupportFolder={onCreateSupportFolder}
                        onDeleteSupportFile={
                          onDeleteSupportFile
                            ? (fileId) => void supportTreeActions.handleDeleteSupportFile(fileId)
                            : undefined
                        }
                        onDragEndNode={
                          onMoveSupportFile ? supportTreeActions.handleSupportTreeDragEnd : undefined
                        }
                        onDragStartNode={
                          onMoveSupportFile
                            ? supportTreeActions.handleSupportTreeDragStart
                            : undefined
                        }
                        onDropNodeOnFolder={
                          onMoveSupportFile
                            ? (parentId, sortOrder) =>
                                void supportTreeActions.handleSupportTreeDrop(parentId, sortOrder)
                            : undefined
                        }
                        onDropNodeOnRoot={
                          onMoveSupportFile
                            ? (sortOrder) =>
                                void supportTreeActions.handleSupportTreeDrop(null, sortOrder)
                            : undefined
                        }
                        onMoveSupportFile={
                          onMoveSupportFile ? supportTreeActions.openMoveSupportDialog : undefined
                        }
                        onOpenSupportFile={openSupportFile}
                        onReorderSupportFile={
                          onReorderSupportFile
                            ? (fileId, direction) =>
                                void supportTreeActions.handleReorderSupportNode(fileId, direction)
                            : undefined
                        }
                        onRenameSupportFile={
                          onRenameSupportFile
                            ? (file) => supportTreeActions.openRenameSupportDialog(file)
                            : undefined
                        }
                        onSetDropTargetParentId={
                          onMoveSupportFile
                            ? supportTreeActions.setDropTargetSupportParentId
                            : undefined
                        }
                        dropTargetParentId={supportTreeActions.dropTargetSupportParentId}
                      />
                    )}
                  </SidebarSection>
                ) : null}

                <SidebarProjectsListSection
                  currentProjectId={currentProjectId}
                  currentWorkspaceId={currentWorkspaceId}
                  currentWorkspaceStatusLabel={currentWorkspaceStatusLabel}
                  isLoading={isLoading}
                  onCreateWorkspace={onCreateWorkspace}
                  onDeleteProject={(projectId) => void handleDelete(projectId)}
                  onOpenProject={openProject}
                  onOpenProjectNextDeliverable={openProjectNextDeliverable}
                  onOpenRenameDialog={openRenameDialog}
                  projects={projects}
                  showEmptyProjectState={showEmptyProjectState}
                  t={t}
                />
              </div>
            )}
          </ScrollArea>

          <div
            className={cn(
              'min-w-0 w-full overflow-hidden border-t border-border',
              collapsed ? 'px-2 py-3' : 'p-3'
            )}
          >
            <AdvancedNavigation collapsed={collapsed} onNavigate={onNavigate} />
          </div>
        </div>
      </aside>

      <DeliverableSidebarDialogs
        availableMountProjects={availableMountProjects}
        closeMountDialog={closeMountDialog}
        closeRenameDialog={closeRenameDialog}
        handleCreateMount={handleCreateMount}
        handleRename={handleRename}
        isCreatingMount={isCreatingMount}
        isMountDialogOpen={isMountDialogOpen}
        isRenamingWorkspace={isRenamingWorkspace}
        mountDialogError={mountDialogError}
        projectTreeActions={projectTreeActions}
        projectTreeRootValue={PROJECT_TREE_ROOT_VALUE}
        renameError={renameError}
        renameValue={renameValue}
        renameWorkspaceId={renameWorkspaceId}
        selectedMountTargetProjectId={selectedMountTargetProjectId}
        setMountDialogError={setMountDialogError}
        setRenameError={setRenameError}
        setRenameValue={setRenameValue}
        setSelectedMountTargetProjectId={setSelectedMountTargetProjectId}
        supportTreeActions={supportTreeActions}
        supportTreeRootValue={SUPPORT_TREE_ROOT_VALUE}
        t={t}
      />
    </>
  );
}
