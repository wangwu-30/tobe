'use client';

import * as React from 'react';
import {
  FilePlus2,
  FileText,
  FolderClosed,
  FolderPlus,
  History,
  MessagesSquare,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';

import { AppTopBar } from '@/components/layout/app-top-bar';
import {
  getSidebarWidthClass,
  SidebarIconButton,
  SidebarInfo,
  SidebarSection,
} from '@/components/layout/sidebar-primitives';
import { useT } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useAppPathname, useAppRouter } from '@/lib/app-router';
import { formatStableDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { formatProjectListMeta } from '@/lib/workspace/project-summary';
import { buildWorkspaceRoute } from '@/lib/workspace/route';
import { apiFetch } from '@/framework/resilience';

import type {
  ConversationBranchSummary,
  ProjectSummaryData,
  WorkspaceFileData,
  WorkspaceVersionData,
} from '@/types';

type WorkspaceTreeState = {
  currentConversationId?: string | null;
  currentFileId?: string | null;
  currentVersionId?: string | null;
  files?: WorkspaceFileData[];
  versions?: WorkspaceVersionData[];
  threads?: ConversationBranchSummary[];
};

type WorkspaceActions = {
  onCreateFile?: (nodeType: 'file' | 'folder', parentId?: string | null) => void;
  onDeleteWorkspace?: (workspaceId: string) => Promise<void> | void;
  onOpenConversation?: (conversationId: string) => void;
  onOpenFile?: (fileId: string) => void;
  onOpenVersion?: (versionId: string | null) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
};

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'dao-sidebar-collapsed';
const WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY = 'dao-workspace-sidebar-collapsed';

export function AppShell({
  actions,
  children,
  currentWorkspaceId,
  renderSidebar,
  sidebarActions,
  sidebarTree,
  subtitle,
  title,
  titleNode,
}: {
  actions?: React.ReactNode;
  children: React.ReactNode;
  currentWorkspaceId?: string | null;
  renderSidebar?: (props: {
    collapsed: boolean;
    onNavigate?: () => void;
  }) => React.ReactNode;
  sidebarActions?: WorkspaceActions;
  sidebarTree?: WorkspaceTreeState;
  subtitle?: string;
  title: string;
  titleNode?: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const sidebarStorageKey = currentWorkspaceId
    ? WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY
    : SIDEBAR_COLLAPSED_STORAGE_KEY;

  React.useEffect(() => {
    const storedState = window.localStorage.getItem(sidebarStorageKey);
    setSidebarCollapsed(storedState === 'true');
  }, [sidebarStorageKey]);

  const toggleSidebarCollapsed = React.useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(sidebarStorageKey, String(next));
      return next;
    });
  }, [sidebarStorageKey]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {renderSidebar ? (
        <div className="hidden md:flex">
          {renderSidebar({ collapsed: sidebarCollapsed })}
        </div>
      ) : (
        <WorkspaceSidebar
          className="hidden md:flex"
          collapsed={sidebarCollapsed}
          currentWorkspaceId={currentWorkspaceId}
          sidebarActions={sidebarActions}
          sidebarTree={sidebarTree}
        />
      )}

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          className="w-[320px] p-0 sm:max-w-[320px]"
          showCloseButton={false}
        >
          {renderSidebar ? (
            renderSidebar({
              collapsed: false,
              onNavigate: () => setSidebarOpen(false),
            })
          ) : (
            <WorkspaceSidebar
              currentWorkspaceId={currentWorkspaceId}
              onNavigate={() => setSidebarOpen(false)}
              sidebarActions={sidebarActions}
              sidebarTree={sidebarTree}
            />
          )}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppTopBar
          title={title}
          titleNode={titleNode}
          subtitle={subtitle}
          actions={actions}
          isSidebarCollapsed={sidebarCollapsed}
          onOpenSidebar={() => setSidebarOpen(true)}
          onToggleSidebarCollapsed={toggleSidebarCollapsed}
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

function WorkspaceSidebar({
  className,
  collapsed = false,
  currentWorkspaceId,
  onNavigate,
  sidebarActions,
  sidebarTree,
}: {
  className?: string;
  collapsed?: boolean;
  currentWorkspaceId?: string | null;
  onNavigate?: () => void;
  sidebarActions?: WorkspaceActions;
  sidebarTree?: WorkspaceTreeState;
}) {
  const t = useT();
  const pathname = useAppPathname();
  const router = useAppRouter();
  const [isLoading, setIsLoading] = React.useState(true);
  const [projects, setProjects] = React.useState<ProjectSummaryData[]>([]);

  const loadProjects = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/project-list');
      if (!res.ok) {
        return;
      }

      const data = await res.json();
      setProjects(data.items || []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadProjects();
  }, [loadProjects, pathname]);

  const handleCreateWorkspace = React.useCallback(async () => {
    onNavigate?.();
    router.push('/?newWorkspace=1');
  }, [onNavigate, router]);

  const handleDeleteWorkspace = React.useCallback(
    async (projectId: string, event: React.MouseEvent) => {
      event.stopPropagation();
      if (!window.confirm(t('sidebar.deleteProjectConfirm'))) {
        return;
      }

      if (sidebarActions?.onDeleteWorkspace) {
        await sidebarActions.onDeleteWorkspace(projectId);
      } else {
        const response = await apiFetch(`/api/projects/${projectId}`, { method: 'DELETE' });
        if (!response.ok) {
          return;
        }

        const deletedCurrentProject = projects.some(
          (project) =>
            project.id === projectId && project.workspaceId === currentWorkspaceId
        );

        if (deletedCurrentProject) {
          onNavigate?.();
          router.push('/');
        }
      }

      await loadProjects();
    },
    [currentWorkspaceId, loadProjects, onNavigate, projects, router, sidebarActions, t]
  );

  const openProject = React.useCallback(
    (project: ProjectSummaryData) => {
      onNavigate?.();
      if (sidebarActions?.onOpenWorkspace) {
        sidebarActions.onOpenWorkspace(project.workspaceId);
        return;
      }
      router.push(
        buildWorkspaceRoute({
          nodeId: project.workspaceId,
          projectId: project.id,
        })
      );
    },
    [onNavigate, router, sidebarActions]
  );
  const openProjectNextDeliverable = React.useCallback(
    (project: ProjectSummaryData) => {
      onNavigate?.();
      const params = new URLSearchParams({
        newDeliverableProjectId: project.id,
        newDeliverableProjectTitle: project.title,
      });
      router.push(`/?${params.toString()}`);
    },
    [onNavigate, router]
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
            aria-label={t('common.home')}
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
              onClick={() => void handleCreateWorkspace()}
            />
          ) : (
            <Button
              className="mt-3 w-full min-w-0 max-w-full justify-start gap-2 overflow-hidden rounded-xl"
              onClick={() => void handleCreateWorkspace()}
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
              ) : projects.length === 0 ? (
                <SidebarInfo compact text="-" />
              ) : (
                projects.map((project) => (
                  <SidebarIconButton
                    key={project.id}
                    active={currentWorkspaceId === project.workspaceId}
                    icon={<FileText className="h-4 w-4" />}
                    label={project.title}
                    onClick={() => openProject(project)}
                  />
                ))
              )}
            </div>
          ) : (
            <div className="min-w-0 space-y-4 px-2 py-3">
              <SidebarSection
                title={t('sidebar.projects')}
                action={
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={() => void handleCreateWorkspace()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                }
              >
                {isLoading ? (
                  <SidebarInfo text={t('sidebar.loadingProjects')} />
                ) : projects.length === 0 ? (
                  <SidebarInfo text={t('sidebar.noProjectsYet')} />
                ) : (
                  <div className="min-w-0 space-y-1">
                    {projects.map((project) => (
                      <div
                        key={project.id}
                        className={cn(
                          'group flex min-w-0 items-center gap-1 overflow-hidden rounded-xl pr-1 transition-colors hover:bg-accent',
                          currentWorkspaceId === project.workspaceId &&
                            'bg-background shadow-sm ring-1 ring-border'
                        )}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 w-full flex-1 items-center gap-2 overflow-hidden px-2 py-1.5 text-left"
                          onClick={() => openProject(project)}
                          data-testid={`sidebar-project-open-${project.id}`}
                        >
                          <div className="shrink-0 rounded-md bg-foreground/5 p-1.5 ring-1 ring-border/30">
                            <FolderClosed className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate text-sm font-medium leading-5">
                              {project.title}
                            </div>
                            <div className="truncate text-[11px] text-muted-foreground/80">
                              {currentWorkspaceId
                                ? formatProjectListMeta(project, t)
                                : `${t('sidebar.continueCurrentDeliverable')} · ${formatProjectListMeta(project, t)}`}
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
                                openProjectNextDeliverable(project);
                              }}
                              data-testid={`sidebar-project-create-next-${project.id}`}
                            >
                              <Plus className="mr-1 h-3.5 w-3.5" />
                              {t('sidebar.newSiblingDeliverable')}
                            </Button>
                          ) : null}
                          <Button
                            size="icon"
                            variant="ghost"
                            className={cn(
                              'h-7 w-7 text-muted-foreground',
                              !currentWorkspaceId &&
                                'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeleteWorkspace(project.id, event);
                            }}
                            title={t('sidebar.deleteProject')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SidebarSection>

              {currentWorkspaceId && sidebarTree ? (
                <>
                  <SidebarSection
                    title={t('sidebar.files')}
                    action={
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => sidebarActions?.onCreateFile?.('file', null)}
                          disabled={!sidebarActions?.onCreateFile}
                        >
                          <FilePlus2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => sidebarActions?.onCreateFile?.('folder', null)}
                          disabled={!sidebarActions?.onCreateFile}
                        >
                          <FolderPlus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    }
                  >
                    {sidebarTree.files && sidebarTree.files.length > 0 ? (
                      <FileTree
                        currentFileId={sidebarTree.currentFileId}
                        files={sidebarTree.files}
                        onOpenFile={sidebarActions?.onOpenFile}
                      />
                    ) : (
                      <SidebarInfo text={t('sidebar.noFilesYet')} />
                    )}
                  </SidebarSection>

                  <SidebarSection title={t('sidebar.threads')}>
                    {sidebarTree.threads && sidebarTree.threads.length > 0 ? (
                      <ConversationTree
                        currentConversationId={sidebarTree.currentConversationId}
                        items={sidebarTree.threads}
                        onOpenConversation={sidebarActions?.onOpenConversation}
                      />
                    ) : (
                      <SidebarInfo text={t('sidebar.noThreadsYet')} />
                    )}
                  </SidebarSection>

                  <SidebarSection title={t('sidebar.versions')}>
                    {sidebarTree.versions && sidebarTree.versions.length > 0 ? (
                      <VersionList
                        currentVersionId={sidebarTree.currentVersionId}
                        onOpenVersion={sidebarActions?.onOpenVersion}
                        versions={sidebarTree.versions}
                      />
                    ) : (
                      <SidebarInfo text={t('sidebar.noVersionsYet')} />
                    )}
                  </SidebarSection>
                </>
              ) : null}
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

function FileTree({
  currentFileId,
  files,
  onOpenFile,
}: {
  currentFileId?: string | null;
  files: WorkspaceFileData[];
  onOpenFile?: (fileId: string) => void;
}) {
  const tree = React.useMemo(() => buildFileTree(files), [files]);

  return (
    <div className="min-w-0 space-y-0.5 overflow-hidden">
      {tree.map((node) => (
        <FileTreeNode
          key={node.id}
          currentFileId={currentFileId}
          node={node}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}

function FileTreeNode({
  currentFileId,
  node,
  onOpenFile,
}: {
  currentFileId?: string | null;
  node: WorkspaceFileNode;
  onOpenFile?: (fileId: string) => void;
}) {
  const [open, setOpen] = React.useState(true);
  const isFolder = node.nodeType === 'folder';
  const isActive = currentFileId === node.id;

  return (
    <div className="min-w-0 overflow-hidden">
      <button
        type="button"
        className={cn(
          'flex min-w-0 w-full max-w-full items-center gap-2 overflow-hidden rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
          isActive && 'bg-background shadow-sm ring-1 ring-border'
        )}
        style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
        onClick={() => {
          if (isFolder) {
            setOpen((value) => !value);
            return;
          }
          onOpenFile?.(node.id);
        }}
      >
        {isFolder ? (
          <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>

      {isFolder && open && node.children.length > 0 ? (
        <div className="mt-0.5 min-w-0 space-y-0.5 overflow-hidden">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.id}
              currentFileId={currentFileId}
              node={child}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ConversationTree({
  currentConversationId,
  items,
  onOpenConversation,
}: {
  currentConversationId?: string | null;
  items: ConversationBranchSummary[];
  onOpenConversation?: (conversationId: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-0.5 overflow-hidden">
      {items.map((item) => (
        <ConversationTreeNode
          key={item.id}
          currentConversationId={currentConversationId}
          depth={0}
          item={item}
          onOpenConversation={onOpenConversation}
        />
      ))}
    </div>
  );
}

function ConversationTreeNode({
  currentConversationId,
  depth,
  item,
  onOpenConversation,
}: {
  currentConversationId?: string | null;
  depth: number;
  item: ConversationBranchSummary;
  onOpenConversation?: (conversationId: string) => void;
}) {
  return (
    <div className="min-w-0 overflow-hidden">
      <button
        type="button"
        className={cn(
          'flex min-w-0 w-full max-w-full items-start gap-2 overflow-hidden rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
          currentConversationId === item.id &&
            'bg-background shadow-sm ring-1 ring-border'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onOpenConversation?.(item.id)}
      >
        <MessagesSquare
          className={cn(
            'mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground',
            currentConversationId === item.id && 'text-foreground'
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {formatConversationTitle(item.title)}
          </span>
          {shouldShowConversationPreview(item.title, item.lastMessagePreview) ? (
            <span className="block truncate text-xs text-muted-foreground">
              {item.lastMessagePreview}
            </span>
          ) : null}
        </span>
      </button>

      {item.children.length > 0 ? (
        <div className="mt-0.5 min-w-0 space-y-0.5 overflow-hidden">
          {item.children.map((child) => (
            <ConversationTreeNode
              key={child.id}
              currentConversationId={currentConversationId}
              depth={depth + 1}
              item={child}
              onOpenConversation={onOpenConversation}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatConversationTitle(title: string) {
  return title.replace(/^Branch:\s*/i, '');
}

function shouldShowConversationPreview(
  title: string,
  preview: string | null
) {
  if (!preview) {
    return false;
  }

  const normalizedTitle = formatConversationTitle(title).trim();
  const normalizedPreview = preview.trim();

  if (!normalizedPreview) {
    return false;
  }

  return !normalizedPreview.startsWith(normalizedTitle);
}

function VersionList({
  currentVersionId,
  onOpenVersion,
  versions,
}: {
  currentVersionId?: string | null;
  onOpenVersion?: (versionId: string | null) => void;
  versions: WorkspaceVersionData[];
}) {
  const t = useT();

  return (
    <div className="min-w-0 space-y-0.5 overflow-hidden">
      <button
        type="button"
        className={cn(
          'flex min-w-0 w-full max-w-full items-center gap-2 overflow-hidden rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
          !currentVersionId && 'bg-background shadow-sm ring-1 ring-border'
        )}
        onClick={() => onOpenVersion?.(null)}
      >
        <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {t('workspace.liveDraft')}
      </button>

      {versions.map((version) => (
        <button
          key={version.id}
          type="button"
          className={cn(
            'flex min-w-0 w-full max-w-full items-start gap-2 overflow-hidden rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
            currentVersionId === version.id &&
              'bg-background shadow-sm ring-1 ring-border'
          )}
          onClick={() => onOpenVersion?.(version.id)}
        >
          <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">
              v{version.versionNum} {version.title}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {formatStableDate(version.lockedAt)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

type WorkspaceFileNode = WorkspaceFileData & {
  children: WorkspaceFileNode[];
  depth: number;
};

function buildFileTree(files: WorkspaceFileData[]) {
  const nodeMap = new Map<string, WorkspaceFileNode>();
  const roots: WorkspaceFileNode[] = [];

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

  const sortTree = (nodes: WorkspaceFileNode[]) => {
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
