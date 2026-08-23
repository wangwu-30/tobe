'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Bot,
  ChevronDown,
  GitBranch,
  History,
  ListTodo,
  Settings,
  SlidersHorizontal,
  Users,
} from 'lucide-react';

import { useT } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppPathname, useAppSearchParams } from '@/lib/app-router';
import { cn } from '@/lib/utils';
import { WORKSPACE_ASSISTANT_SEARCH_PARAM } from '@/lib/workspace/route';

type AdvancedNavigationProps = {
  collapsed?: boolean;
  onNavigate?: () => void;
};

type AdvancedNavigationItem = {
  active: boolean;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  testId?: string;
};

const ADVANCED_ROUTES = ['/knowledge', '/tasks', '/agents', '/jobs', '/settings'];

export function AdvancedNavigation({
  collapsed = false,
  onNavigate,
}: AdvancedNavigationProps) {
  return (
    <React.Suspense fallback={null}>
      <AdvancedNavigationContent
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
    </React.Suspense>
  );
}

function AdvancedNavigationContent({
  collapsed = false,
  onNavigate,
}: AdvancedNavigationProps) {
  const t = useT();
  const pathname = useAppPathname();
  const searchParams = useAppSearchParams();
  const disclosureId = React.useId();
  const assistantParam = searchParams.get(WORKSPACE_ASSISTANT_SEARCH_PARAM);
  const roomHref = React.useMemo(() => {
    if (!/^\/workspace\/[^/]+$/.test(pathname)) {
      return null;
    }

    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete(WORKSPACE_ASSISTANT_SEARCH_PARAM);
    nextSearchParams.set(WORKSPACE_ASSISTANT_SEARCH_PARAM, 'room');
    return `${pathname}?${nextSearchParams.toString()}`;
  }, [pathname, searchParams]);
  const isRoomRoute = roomHref !== null && assistantParam === 'room';
  const isAdvancedRoute = isRoomRoute || ADVANCED_ROUTES.some((route) =>
    route === '/settings' ? pathname === route : pathname.startsWith(route)
  );
  const [open, setOpen] = React.useState(isAdvancedRoute);
  const label = `${t('sidebar.advanced')} / ${t('common.settings')}`;
  const items = React.useMemo<AdvancedNavigationItem[]>(
    () => [
      ...(roomHref
        ? [
            {
              active: isRoomRoute,
              href: roomHref,
              icon: Users,
              label: t('sidebar.room'),
              testId: 'sidebar-advanced-room-link',
            },
          ]
        : []),
      {
        active: pathname.startsWith('/knowledge'),
        href: '/knowledge',
        icon: GitBranch,
        label: t('sidebar.gitKnowledge'),
      },
      {
        active: pathname.startsWith('/tasks'),
        href: '/tasks',
        icon: ListTodo,
        label: t('sidebar.teamTasks'),
      },
      {
        active: pathname.startsWith('/agents'),
        href: '/agents',
        icon: Bot,
        label: t('sidebar.agents'),
      },
      {
        active: pathname.startsWith('/jobs'),
        href: '/jobs',
        icon: History,
        label: t('sidebar.jobs'),
      },
      {
        active: pathname === '/settings',
        href: '/settings',
        icon: Settings,
        label: t('common.settings'),
      },
    ],
    [isRoomRoute, pathname, roomHref, t]
  );

  React.useEffect(() => {
    if (isAdvancedRoute) {
      setOpen(true);
    }
  }, [isAdvancedRoute]);

  if (collapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={label}
            className={cn(
              'h-10 w-10 rounded-xl border border-transparent',
              isAdvancedRoute && 'border-border bg-background shadow-sm'
            )}
            data-testid="sidebar-advanced-toggle"
            size="icon-sm"
            title={label}
            variant={isAdvancedRoute ? 'secondary' : 'ghost'}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuItem asChild key={item.href}>
                <Link
                  aria-current={item.active ? 'page' : undefined}
                  href={item.href}
                  onClick={onNavigate}
                  data-testid={item.testId}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="min-w-0">
      <Button
        aria-controls={disclosureId}
        aria-expanded={open}
        className="w-full min-w-0 max-w-full justify-start gap-2 overflow-hidden rounded-xl"
        data-testid="sidebar-advanced-toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
        variant={isAdvancedRoute ? 'secondary' : 'ghost'}
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown
          className={cn(
            'ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
            open && 'rotate-180'
          )}
        />
      </Button>
      {open ? (
        <div className="mt-1 space-y-1 pl-3" id={disclosureId}>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                asChild
                className="w-full min-w-0 max-w-full justify-start gap-2 overflow-hidden rounded-xl"
                key={item.href}
                variant={item.active ? 'secondary' : 'ghost'}
              >
                <Link
                  aria-current={item.active ? 'page' : undefined}
                  href={item.href}
                  onClick={onNavigate}
                  data-testid={item.testId}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
