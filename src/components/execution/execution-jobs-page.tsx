'use client';

import * as React from 'react';
import { AlertCircle, Bot, ChevronRight, LoaderCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';

import { AppShell } from '@/components/layout/app-shell';
import { useT } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ZoneErrorBoundary } from '@/framework/resilience';
import { useAppPathname, useAppRouter, useAppSearchParams } from '@/lib/app-router';
import { listExecutionJobs, type ExecutionJobSummary } from '@/lib/execution/client';
import { formatStableDateTime } from '@/lib/time';

import { ExecutionStatusBadge } from './execution-status';

export function ExecutionJobsPage() {
  const t = useT();
  const tRef = React.useRef(t);
  React.useEffect(() => {
    tRef.current = t;
  }, [t]);
  const pathname = useAppPathname();
  const router = useAppRouter();
  const searchParams = useAppSearchParams();
  const [items, setItems] = React.useState<ExecutionJobSummary[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const activeRequestRef = React.useRef<AbortController | null>(null);
  const requestGenerationRef = React.useRef(0);
  const search = (searchParams.get('q') || '').trim();
  const [searchDraft, setSearchDraft] = React.useState(search);
  const searchInputId = React.useId();
  const searchHintId = React.useId();
  const searchStatusId = React.useId();

  const replaceSearchQuery = React.useCallback(
    (nextSearch: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      const normalizedSearch = nextSearch.trim();
      if (normalizedSearch) {
        nextParams.set('q', normalizedSearch);
      } else {
        nextParams.delete('q');
      }
      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  React.useEffect(() => {
    const currentQuery = searchParams.toString();
    const nextParams = new URLSearchParams(currentQuery);
    if (search) {
      nextParams.set('q', search);
    } else {
      nextParams.delete('q');
    }
    const normalizedQuery = nextParams.toString();
    if (normalizedQuery !== currentQuery) {
      router.replace(normalizedQuery ? `${pathname}?${normalizedQuery}` : pathname, {
        scroll: false,
      });
    }
  }, [pathname, router, search, searchParams]);

  React.useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  const load = React.useCallback(async (nextCursor: string | null = null) => {
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const generation = ++requestGenerationRef.current;
    const append = nextCursor !== null;
    const requestSearch = search;

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setLoadingMore(false);
      setItems([]);
      setCursor(null);
      setHasNextPage(false);
    }
    setError(null);
    try {
      const result = await listExecutionJobs({
        cursor: nextCursor,
        limit: 50,
        search: requestSearch || null,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        generation !== requestGenerationRef.current
      ) {
        return;
      }
      if (!result.ok) {
        setError(result.error);
      } else {
        setItems((current) =>
          append ? appendUniqueJobs(current, result.data.items) : result.data.items
        );
        setCursor(result.data.pageInfo.nextCursor);
        setHasNextPage(result.data.pageInfo.hasNextPage);
      }
    } catch {
      if (
        controller.signal.aborted ||
        generation !== requestGenerationRef.current
      ) {
        return;
      }
      setError(tRef.current('jobs.loadFailed'));
    } finally {
      if (
        controller.signal.aborted ||
        generation !== requestGenerationRef.current
      ) {
        return;
      }
      activeRequestRef.current = null;
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, [search]);

  React.useEffect(() => {
    void load();
    return () => {
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;
      requestGenerationRef.current += 1;
    };
  }, [load]);

  const statusSummary = loading
    ? t('jobs.loadingStatus')
    : search
      ? t(items.length === 1 ? 'jobs.shownSingleQuery' : 'jobs.shownPluralQuery', {
          count: items.length,
          query: search,
        })
      : t(items.length === 1 ? 'jobs.shownSingle' : 'jobs.shownPlural', {
          count: items.length,
        });

  return (
    <AppShell title={t('jobs.shellTitle')} subtitle={t('jobs.shellSubtitle')}>
      <ZoneErrorBoundary zone="execution-jobs">
        <main className="h-full overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
            <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  <Bot aria-hidden="true" className="size-3.5" /> {t('jobs.eyebrow')}
                </div>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t('jobs.heading')}</h1>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  {t('jobs.lead')}
                </p>
              </div>
              <Button aria-busy={loading || loadingMore} disabled={loading || loadingMore} onClick={() => void load()} variant="outline">
                <RefreshCw className={loading ? 'animate-spin motion-reduce:animate-none' : ''} /> {t('jobs.refresh')}
              </Button>
            </header>

            <div className="mt-6">
              <label className="sr-only" htmlFor={searchInputId}>
                {t('jobs.searchLabel')}
              </label>
              <Input
                aria-describedby={`${searchHintId} ${searchStatusId}`}
                autoComplete="off"
                className="max-w-md"
                id={searchInputId}
                maxLength={200}
                name="execution-job-search"
                onChange={(event) => {
                  setSearchDraft(event.target.value);
                  replaceSearchQuery(event.target.value);
                }}
                placeholder={t('jobs.searchPlaceholder')}
                type="search"
                value={searchDraft}
              />
              <p className="mt-2 max-w-2xl text-xs text-muted-foreground" id={searchHintId}>
                {t('jobs.searchHint')}
              </p>
              <p
                aria-live="polite"
                className="mt-1 text-xs text-muted-foreground"
                id={searchStatusId}
                role="status"
              >
                {statusSummary}
              </p>
            </div>

            {error ? (
              <div aria-live="assertive" className="mt-5 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
                <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">{error}</span>
              </div>
            ) : null}

            <section
              aria-busy={loading || loadingMore}
              aria-label={t('jobs.resultsAria')}
              className="mt-5 space-y-3"
              data-testid="execution-job-list"
            >
              {loading ? (
                <div aria-live="polite" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground" role="status">
                  <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> {t('jobs.loadingText')}
                </div>
              ) : items.length === 0 ? (
                <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('jobs.empty')}</CardContent></Card>
              ) : items.map((job) => (
                <Link
                  className="block w-full rounded-xl text-left outline-none ring-ring transition hover:bg-muted/30 focus-visible:ring-2 motion-reduce:transition-none"
                  data-testid={`execution-job-${job.id}`}
                  href={`/jobs/${encodeURIComponent(job.id)}`}
                  key={job.id}
                >
                  <Card className="gap-0 py-0 shadow-none">
                    <CardContent className="flex items-center gap-4 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <ExecutionStatusBadge status={job.status} />
                          <span className="text-xs uppercase tracking-wide text-muted-foreground">{job.kind}</span>
                        </div>
                        <h2 className="mt-2 break-words font-medium [overflow-wrap:anywhere]">{job.goal}</h2>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{t('jobs.attemptsRatio', { count: job.attemptCount, max: job.maxAttempts })}</span>
                          <span className="break-all">{job.selectedRuntimeId || t('jobs.runtimePending')}</span>
                          <span>{formatStableDateTime(job.updatedAt)}</span>
                        </div>
                      </div>
                      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </section>

            {hasNextPage && cursor ? (
              <div className="mt-5 flex justify-center">
                <Button aria-busy={loadingMore} disabled={loadingMore} onClick={() => void load(cursor)} variant="outline">
                  {loadingMore ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}
                  {t('jobs.loadMore')}
                </Button>
              </div>
            ) : null}
          </div>
        </main>
      </ZoneErrorBoundary>
    </AppShell>
  );
}

function appendUniqueJobs(
  current: ExecutionJobSummary[],
  next: ExecutionJobSummary[]
) {
  const existingIds = new Set(current.map((job) => job.id));
  return [...current, ...next.filter((job) => !existingIds.has(job.id))];
}
