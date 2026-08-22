'use client';

import * as React from 'react';
import { PanelLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function AppTopBar({
  actions,
  isSidebarCollapsed = false,
  onOpenSidebar,
  onToggleSidebarCollapsed,
  subtitle,
  title,
  titleNode,
}: {
  actions?: React.ReactNode;
  isSidebarCollapsed?: boolean;
  onOpenSidebar?: () => void;
  onToggleSidebarCollapsed?: () => void;
  subtitle?: string;
  title: string;
  titleNode?: React.ReactNode;
}) {
  return (
    <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex min-h-16 w-full items-center gap-3 px-3 py-2 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            onClick={onToggleSidebarCollapsed}
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onOpenSidebar}
            aria-label="Open navigation"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>

          <div className="min-w-0 flex-1">
            {titleNode || (
              <div className="truncate text-sm font-semibold">{title}</div>
            )}
            {subtitle && (
              <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 shrink items-center gap-2 overflow-x-auto py-1">
          {actions}
        </div>
      </div>
    </header>
  );
}
