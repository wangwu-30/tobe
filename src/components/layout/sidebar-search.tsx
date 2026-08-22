'use client';

import * as React from 'react';
import Link from 'next/link';
import { Loader2, Search } from 'lucide-react';

import { useT } from '@/components/providers/language-provider';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { searchWorkspaceProjectNodes } from '@/lib/workspace/project-client';
import { buildWorkspaceRoute } from '@/lib/workspace/route';
import { DeliverableTypeIcon } from '@/components/workspace/deliverable-type-badge';
import type { ProjectNodeSearchResultData } from '@/types';

export function SidebarSearch({
  currentNodeId,
  onNavigate,
  projectId,
}: {
  currentNodeId?: string | null;
  onNavigate?: () => void;
  projectId: string;
}) {
  const t = useT();
  const [query, setQuery] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [results, setResults] = React.useState<ProjectNodeSearchResultData[]>([]);
  const debouncedQuery = useDebounce(query, 250);
  const trimmedQuery = debouncedQuery.trim();

  React.useEffect(() => {
    let cancelled = false;

    if (!projectId || !trimmedQuery) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);
    setError(null);

    void searchWorkspaceProjectNodes({
      currentNodeId,
      errorMessage: t('sidebar.searchProjectNodesFailed'),
      limit: 8,
      projectId,
      query: trimmedQuery,
    })
      .then((nextResults) => {
        if (cancelled) {
          return;
        }
        setResults(nextResults);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }
        setResults([]);
        setError(
          nextError instanceof Error
            ? nextError.message
            : t('sidebar.searchProjectNodesFailed')
        );
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentNodeId, projectId, t, trimmedQuery]);

  const handleOpenResult = React.useCallback(() => {
      onNavigate?.();
      setQuery('');
      setResults([]);
      setError(null);
  }, [onNavigate]);

  const hasQuery = query.trim().length > 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/80">
      <div className="relative border-b border-border/70">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={t('sidebar.searchProjectNodes')}
          aria-describedby="sidebar-node-search-status"
          autoComplete="off"
          name="projectSearch"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('sidebar.searchProjectNodesPlaceholder')}
          className="h-11 border-0 bg-transparent pl-9 pr-10 shadow-none focus-visible:ring-0"
          data-testid="sidebar-node-search-input"
          type="search"
        />
        {isLoading ? (
          <Loader2
            aria-hidden="true"
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none"
          />
        ) : null}
      </div>

      <div
        aria-atomic="true"
        aria-live="polite"
        className="min-w-0 px-2 py-2"
        id="sidebar-node-search-status"
      >
        {!hasQuery ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {t('sidebar.searchProjectNodesHint')}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </div>
        ) : isLoading ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {t('sidebar.searchProjectNodesLoading')}
          </div>
        ) : results.length === 0 ? (
          <div
            className="px-2 py-1 text-xs text-muted-foreground"
            data-testid="sidebar-node-search-empty"
          >
            {t('sidebar.searchProjectNodesEmpty')}
          </div>
        ) : (
          <div className="space-y-1" data-testid="sidebar-node-search-results">
            {results.map((result) => (
              <Link
                key={result.id}
                href={buildWorkspaceRoute({
                  nodeId: result.id,
                  projectId: result.projectId,
                })}
                className={cn(
                  'flex min-h-11 w-full min-w-0 touch-manipulation items-start gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                  result.isCurrent && 'bg-accent/60'
                )}
                onClick={handleOpenResult}
                data-testid={`sidebar-node-search-result-${result.id}`}
              >
                <div className="mt-0.5 shrink-0 rounded-md bg-foreground/5 p-1.5 ring-1 ring-border/30">
                  <DeliverableTypeIcon
                    className="h-3.5 w-3.5 text-muted-foreground"
                    deliverableType={result.deliverableType}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate text-sm font-medium">{result.title}</div>
                    {result.isCurrent ? (
                      <Badge
                        variant="secondary"
                        className="shrink-0 rounded-full px-1.5 py-0 text-[10px]"
                      >
                        {t('sidebar.currentDeliverableBadge')}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {result.matchPreview}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
