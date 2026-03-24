'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export const SIDEBAR_COLLAPSED_CLASS = 'w-[76px]';
export const SIDEBAR_EXPANDED_CLASS = 'w-[300px]';

export function getSidebarWidthClass(collapsed: boolean) {
  return collapsed ? SIDEBAR_COLLAPSED_CLASS : SIDEBAR_EXPANDED_CLASS;
}

export function SidebarSection({
  action,
  children,
  className,
  testId,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
  title: string;
}) {
  return (
    <section className={cn('min-w-0 overflow-hidden', className)} data-testid={testId}>
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2 px-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SidebarInfo({
  compact = false,
  text,
}: {
  compact?: boolean;
  text: string;
}) {
  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-2xl border border-dashed border-border/70 text-center text-xs text-muted-foreground',
        compact ? 'w-10 px-0 py-3' : 'px-3 py-5'
      )}
    >
      {text}
    </div>
  );
}

export function SidebarIconButton({
  active = false,
  ariaLabel,
  className,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  ariaLabel?: string;
  className?: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant={active ? 'secondary' : 'ghost'}
          className={cn(
            'h-10 w-10 rounded-xl border border-transparent',
            active && 'border-border bg-background shadow-sm',
            className
          )}
          onClick={onClick}
          aria-label={ariaLabel || label}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
