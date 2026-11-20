'use client';

import * as React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

import type { DiffRow } from './deliverable-version-helpers';

export function HeaderStat({
  emphasized = false,
  label,
  value,
}: {
  emphasized?: boolean;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={emphasized ? 'font-medium text-foreground' : 'font-medium'}>
        {value}
      </span>
    </span>
  );
}

export function HeaderDivider() {
  return <span className="h-3 w-px bg-border/80" aria-hidden="true" />;
}

export function BranchOverviewCard({
  actions,
  cardTestId,
  current,
  currentBranch,
  currentBranchLabel,
  currentBranchTestId,
  currentLabel,
  lineage,
  lineageLabel,
  milestoneCountLabel,
  onOpen,
  subtitle,
  title,
}: {
  actions: React.ReactNode;
  cardTestId?: string;
  current: boolean;
  currentBranch: boolean;
  currentBranchLabel: string;
  currentBranchTestId?: string;
  currentLabel: string;
  lineage: string;
  lineageLabel: string;
  milestoneCountLabel: string;
  onOpen?: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div
      className={[
        'rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 shadow-sm',
        onOpen
          ? 'cursor-pointer transition-colors hover:border-foreground/20 hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
          : '',
      ].join(' ')}
      data-testid={cardTestId}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-medium text-foreground">{title}</div>
            {currentBranch ? (
              <Badge
                variant="secondary"
                className="text-[10px]"
                data-testid={currentBranchTestId}
              >
                {currentBranchLabel}
              </Badge>
            ) : null}
            {current ? (
              <Badge variant="outline" className="text-[10px]">
                {currentLabel}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] font-normal">
              {milestoneCountLabel}
            </Badge>
            <span>
              <span className="font-medium text-foreground/80">{lineageLabel}</span>
              {': '}
              {lineage}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
          {actions}
        </div>
      </div>
    </div>
  );
}

export function HistoryCard({
  actions,
  badge,
  branchHead,
  branchHeadLabel,
  branchHeadTestId,
  cardTestId,
  current,
  currentLabel,
  depth,
  draftBase,
  draftBaseLabel,
  draftBaseTestId,
  lineage,
  onOpen,
  subtitle,
  title,
}: {
  actions: React.ReactNode;
  badge: string;
  branchHead: boolean;
  branchHeadLabel: string;
  branchHeadTestId?: string;
  cardTestId?: string;
  current: boolean;
  currentLabel: string;
  depth: number;
  draftBase: boolean;
  draftBaseLabel: string;
  draftBaseTestId?: string;
  lineage: string | null;
  onOpen?: () => void;
  subtitle: string;
  title: string;
}) {
  const indent = depth * 18;
  return (
    <div className="relative" style={indent > 0 ? { paddingLeft: `${indent}px` } : undefined}>
      {depth > 0 ? (
        <>
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-px bg-border/60"
            style={{ left: `${indent - 10}px` }}
          />
          <div
            className="pointer-events-none absolute h-px w-3 bg-border/60"
            style={{ left: `${indent - 10}px`, top: '28px' }}
          />
        </>
      ) : null}
      <div
        className={[
          'rounded-2xl border border-border/70 bg-background px-4 py-3 shadow-sm',
          onOpen
            ? 'cursor-pointer transition-colors hover:border-foreground/20 hover:bg-muted/10 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
            : '',
        ].join(' ')}
        data-lineage-depth={depth}
        data-testid={cardTestId}
        onClick={onOpen}
        onKeyDown={
          onOpen
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpen();
                }
              }
            : undefined
        }
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-medium text-foreground">{title}</div>
              <Badge variant="outline" className="text-[10px]">
                {badge}
              </Badge>
              {current ? (
                <Badge variant="secondary" className="text-[10px]">
                  {currentLabel}
                </Badge>
              ) : null}
              {draftBase ? (
                <Badge
                  variant="secondary"
                  className="text-[10px]"
                  data-testid={draftBaseTestId}
                >
                  {draftBaseLabel}
                </Badge>
              ) : null}
              {branchHead ? (
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  data-testid={branchHeadTestId}
                >
                  {branchHeadLabel}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
            {lineage ? (
              <div className="mt-1 text-xs text-muted-foreground">{lineage}</div>
            ) : null}
          </div>
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EmptyHistoryCard({ text, testId }: { text: string; testId?: string }) {
  return (
    <div
      className="rounded-2xl border border-dashed border-border/80 px-4 py-5 text-center text-xs text-muted-foreground"
      data-testid={testId}
    >
      {text}
    </div>
  );
}

export function VersionPane({
  label,
  text,
}: {
  label: string;
  text: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-muted/20">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-xs font-medium">{label}</div>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="max-h-[460px] overflow-auto px-3 py-3 text-xs leading-6 text-foreground/90">
        <pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
      </div>
    </div>
  );
}

export function DiffViewer({
  leftLabel,
  rightLabel,
  rows,
}: {
  leftLabel: string;
  rightLabel: string;
  rows: DiffRow[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-muted/20">
      <div className="grid grid-cols-2 border-b border-border bg-background/70">
        <div className="border-r border-border px-3 py-2 text-xs font-medium">{leftLabel}</div>
        <div className="px-3 py-2 text-xs font-medium">{rightLabel}</div>
      </div>

      <div className="max-h-[520px] overflow-auto">
        {rows.map((row, index) => (
          <div key={`${row.type}-${index}`} className="grid grid-cols-2 text-xs font-mono leading-6">
            <DiffCell side="left" text={row.left} type={row.type} />
            <DiffCell side="right" text={row.right} type={row.type} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffCell({
  side,
  text,
  type,
}: {
  side: 'left' | 'right';
  text: string;
  type: DiffRow['type'];
}) {
  const tone =
    type === 'change'
      ? 'bg-amber-500/10'
      : type === 'add' && side === 'right'
        ? 'bg-emerald-500/10'
        : type === 'remove' && side === 'left'
          ? 'bg-rose-500/10'
          : 'bg-transparent';

  return (
    <div
      className={`min-w-0 border-b border-border/50 px-3 py-1.5 ${side === 'left' ? 'border-r border-border/50' : ''} ${tone}`}
    >
      <pre className="whitespace-pre-wrap break-words">{text || ' '}</pre>
    </div>
  );
}
