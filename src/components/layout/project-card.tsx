'use client';

import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';

import { useAppLanguage, useT } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { formatRelativeTime, formatStableDateTime } from '@/lib/time';

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
  const latestPageTitle =
    project.latestDeliverableTitle?.trim() ||
    project.preview?.trim() ||
    t('home.projectCardNoRecentNode');
  const relativeUpdatedAt = formatRelativeTime(
    project.updatedAt,
    language,
    t('home.projectCardNoRecentNode')
  );

  return (
    <div
      className="flex min-w-0 items-center gap-2 border-b border-border/60 py-2.5 last:border-b-0"
      data-testid={`home-project-card-${project.id}`}
    >
      <Link
        href={currentHref}
        className="flex min-w-0 flex-1 touch-manipulation items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        data-testid={`home-project-open-${project.id}`}
      >
        <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={project.title}>
            {project.title}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{latestPageTitle}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0" title={formatStableDateTime(project.updatedAt)}>
              {relativeUpdatedAt}
            </span>
          </div>
        </div>
      </Link>

      <Button
        asChild
        className="h-11 min-h-11 shrink-0 gap-1.5 md:h-11 md:min-h-11"
        size="sm"
        variant="ghost"
      >
        <Link
          aria-label={`${t('home.projectCardNewItem')}: ${project.title}`}
          data-testid={`home-project-next-${project.id}`}
          href={nextHref}
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('home.projectCardNewItem')}</span>
        </Link>
      </Button>
    </div>
  );
}
