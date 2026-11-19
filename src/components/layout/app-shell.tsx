'use client';

import * as React from 'react';

import { AppTopBar } from '@/components/layout/app-top-bar';
import { DeliverableSidebar } from '@/components/workspace/deliverable-sidebar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useAppRouter } from '@/lib/app-router';
import {
  useGuardedRouter,
  useNavigationGuardRuntime,
} from '@/lib/navigation/navigation-guard';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'dao-sidebar-collapsed';
const WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY = 'dao-workspace-sidebar-collapsed';

export function AppShell({
  actions,
  children,
  currentWorkspaceId,
  renderSidebar,
  subtitle,
  title,
  titleNode,
}: {
  actions?: React.ReactNode;
  children: React.ReactNode;
  currentWorkspaceId?: string | null;
  renderSidebar?: (props: {
    collapsed: boolean;
    onExpandSidebar?: () => void;
    onNavigate?: () => void;
  }) => React.ReactNode;
  subtitle?: string;
  title: string;
  titleNode?: React.ReactNode;
}) {
  useNavigationGuardRuntime();
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

  const expandSidebar = React.useCallback(() => {
    setSidebarCollapsed(false);
    window.localStorage.setItem(sidebarStorageKey, 'false');
  }, [sidebarStorageKey]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a
        className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-md bg-background px-4 py-2 text-sm font-medium shadow-lg ring-2 ring-ring transition-transform focus-visible:translate-y-0 focus-visible:outline-none motion-reduce:transition-none"
        href="#main-content"
      >
        Skip to main content
      </a>
      {renderSidebar ? (
        <div className="hidden md:flex">
          {renderSidebar({
            collapsed: sidebarCollapsed,
            onExpandSidebar: expandSidebar,
          })}
        </div>
      ) : (
        <DefaultAppSidebar
          className="hidden md:flex"
          collapsed={sidebarCollapsed}
          currentWorkspaceId={currentWorkspaceId}
          onExpandSidebar={expandSidebar}
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
              onExpandSidebar: expandSidebar,
              onNavigate: () => setSidebarOpen(false),
            })
          ) : (
            <DefaultAppSidebar
              collapsed={false}
              currentWorkspaceId={currentWorkspaceId}
              onExpandSidebar={expandSidebar}
              onNavigate={() => setSidebarOpen(false)}
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
        <div
          className="min-h-0 min-w-0 flex-1 overflow-hidden"
          id="main-content"
          tabIndex={-1}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function DefaultAppSidebar({
  className,
  collapsed = false,
  currentWorkspaceId,
  onExpandSidebar,
  onNavigate,
}: {
  className?: string;
  collapsed?: boolean;
  currentWorkspaceId?: string | null;
  onExpandSidebar?: () => void;
  onNavigate?: () => void;
}) {
  const router = useAppRouter();
  const guardedRouter = useGuardedRouter();

  const handleCreateWorkspace = React.useCallback(() => {
    guardedRouter.push('/?newWorkspace=1', () => {
      onNavigate?.();
      router.push('/?newWorkspace=1');
    });
  }, [guardedRouter, onNavigate, router]);

  return (
    <DeliverableSidebar
      className={className}
      collapsed={collapsed}
      currentWorkspaceId={currentWorkspaceId ?? null}
      onCreateWorkspace={handleCreateWorkspace}
      onNavigate={onNavigate}
      onRequestExpand={onExpandSidebar}
      outlineItems={[]}
    />
  );
}
