'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, FolderClosed, Plus } from 'lucide-react';

import { useAppLanguage, useT } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatRelativeTime, formatStableDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { formatProjectDeliverableCount } from '@/lib/workspace/project-summary';

import type { ProjectSummaryData } from '@/types';

export function ProjectCard({
  currentHref,
  nextHref,
  project,
}: {
  currentHref: string;
  nextHref: string;
  project: ProjectSummaryData;
}) {
  const t = useT();
  const language = useAppLanguage();
  const isSingleNode = project.deliverableCount <= 1;
  const latestNodeTitle =
    project.latestDeliverableTitle?.trim() ||
    project.preview?.trim() ||
    t('home.projectCardNoRecentNode');
  const relativeUpdatedAt = formatRelativeTime(
    project.updatedAt,
    language,
    t('home.projectCardNoRecentNode')
  );

  return (
    <Card
      className="overflow-hidden rounded-[28px] border-border/70 bg-background/80 py-0 shadow-sm"
      data-testid={`home-project-card-${project.id}`}
    >
      <Link
        href={currentHref}
        className={cn(
          'group flex w-full touch-manipulation flex-col gap-5 px-5 py-5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none'
        )}
        data-testid={`home-project-open-${project.id}`}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="shrink-0 rounded-2xl bg-foreground/5 p-2.5 ring-1 ring-border/40">
            <FolderClosed className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div
                  className="line-clamp-2 break-words text-base font-semibold leading-6"
                  title={project.title}
                >
                  {project.title}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatProjectDeliverableCount(project.deliverableCount, t)}
                </div>
              </div>
              <div
                className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground"
                title={formatStableDateTime(project.updatedAt)}
              >
                {relativeUpdatedAt}
              </div>
            </div>
          </div>
        </div>

        {!isSingleNode && (
          <div className="rounded-2xl border border-border/60 bg-muted/25 px-4 py-4">
            <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {t('home.projectCardLatestNode')}
            </div>
            <div className="mt-2 line-clamp-2 text-sm font-medium leading-6">{latestNodeTitle}</div>
          </div>
        )}

        <div className="flex items-center justify-between text-sm font-medium text-foreground">
          <span>{t('home.projectCardOpen')}</span>
          <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </div>
      </Link>

      <div className="border-t border-border/60 px-5 py-4">
        <Button
          asChild
          variant="outline"
          className="w-full justify-between rounded-xl"
        >
          <Link data-testid={`home-project-next-${project.id}`} href={nextHref}>
            <span>{t('home.projectCardNewItem')}</span>
            <Plus aria-hidden="true" className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </Card>
  );
}
