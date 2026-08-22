'use client';

import * as React from 'react';
import { AlertCircle, Bot, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';

import { AppShell } from '@/components/layout/app-shell';
import { useAppLanguage } from '@/components/providers/language-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ZoneErrorBoundary } from '@/framework/resilience';
import { useAppPathname, useAppRouter, useAppSearchParams } from '@/lib/app-router';
import {
  listAgents,
  updateAgent,
  type AgentProfileDtoV1,
} from '@/lib/agents/client';
import { cn } from '@/lib/utils';
import { AgentCard } from './agent-card';
import { AgentEditorDialog } from './agent-editor-dialog';

type StatusFilter = 'all' | 'disabled' | 'enabled';
type AgentParamKey = 'q' | 'status';
const AGENT_STATUS_FILTERS = new Set<StatusFilter>(['all', 'disabled', 'enabled']);

export function AgentManagementPage() {
  const language = useAppLanguage();
  const pathname = useAppPathname();
  const router = useAppRouter();
  const searchParams = useAppSearchParams();
  const [agents, setAgents] = React.useState<AgentProfileDtoV1[]>([]);
  const [canManage, setCanManage] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingAgent, setEditingAgent] = React.useState<AgentProfileDtoV1 | null>(null);
  const [updatingIds, setUpdatingIds] = React.useState<Set<string>>(new Set());
  const noticeTimerRef = React.useRef<number | null>(null);
  const requestGenerationRef = React.useRef(0);
  const query = searchParams.get('q') || '';
  const statusFilter = readAgentStatusFilter(searchParams.get('status'));

  const replaceAgentParams = React.useCallback(
    (updates: Partial<Record<AgentParamKey, string>>) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates) as Array<[AgentParamKey, string]>) {
        if (isDefaultAgentParam(key, value)) {
          nextParams.delete(key);
        } else {
          nextParams.set(key, value);
        }
      }
      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  React.useEffect(() => {
    const currentQuery = searchParams.toString();
    const nextParams = new URLSearchParams(currentQuery);
    const normalizedValues: Record<AgentParamKey, string> = {
      q: query,
      status: statusFilter,
    };

    for (const [key, value] of Object.entries(normalizedValues) as Array<
      [AgentParamKey, string]
    >) {
      if (isDefaultAgentParam(key, value)) {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    }

    const normalizedQuery = nextParams.toString();
    if (normalizedQuery !== currentQuery) {
      router.replace(normalizedQuery ? `${pathname}?${normalizedQuery}` : pathname, {
        scroll: false,
      });
    }
  }, [pathname, query, router, searchParams, statusFilter]);

  const showNotice = React.useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);

  React.useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    },
    []
  );

  const loadAgents = React.useCallback(async (refresh = false, signal?: AbortSignal) => {
    const generation = ++requestGenerationRef.current;
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const result = await listAgents({ signal });
      if (signal?.aborted || generation !== requestGenerationRef.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAgents(sortAgents(result.data.agents));
      setCanManage(result.data.permissions.canManage);
    } catch (caught) {
      if (signal?.aborted || generation !== requestGenerationRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Agents could not be loaded.');
    } finally {
      if (signal?.aborted || generation !== requestGenerationRef.current) return;
      if (refresh) setIsRefreshing(false);
      else setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void loadAgents(false, controller.signal);
    return () => controller.abort();
  }, [loadAgents]);

  const filteredAgents = React.useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return agents.filter((agent) => {
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'enabled' ? agent.enabled : !agent.enabled);
      const searchable = [
        agent.name,
        agent.handle,
        agent.description,
        ...agent.capabilities.skills,
      ]
        .join(' ')
        .toLocaleLowerCase();
      return matchesStatus && (!needle || searchable.includes(needle));
    });
  }, [agents, query, statusFilter]);

  const counts = React.useMemo(
    () => ({
      disabled: agents.filter((agent) => !agent.enabled).length,
      enabled: agents.filter((agent) => agent.enabled).length,
    }),
    [agents]
  );
  const numberFormat = React.useMemo(() => new Intl.NumberFormat(language), [language]);

  const openCreate = () => {
    setEditingAgent(null);
    setEditorOpen(true);
  };

  const openEdit = (agent: AgentProfileDtoV1) => {
    setEditingAgent(agent);
    setEditorOpen(true);
  };

  const handleSaved = (savedAgent: AgentProfileDtoV1, created: boolean) => {
    setAgents((current) =>
      sortAgents([savedAgent, ...current.filter((agent) => agent.id !== savedAgent.id)])
    );
    showNotice(created ? `${savedAgent.name} was created.` : `${savedAgent.name} was updated.`);
  };

  const toggleEnabled = async (agent: AgentProfileDtoV1) => {
    if (!canManage || agent.builtin || updatingIds.has(agent.id)) return;
    setError(null);
    setUpdatingIds((current) => new Set(current).add(agent.id));
    try {
      const result = await updateAgent(agent.id, {
        enabled: !agent.enabled,
        expectedRevision: agent.revision,
        schemaVersion: 1,
      });

      if (!result.ok) {
        setError(
          result.status === 409
            ? 'This agent changed elsewhere. Refresh the list before trying again.'
            : result.error
        );
      } else {
        setAgents((current) =>
          sortAgents(
            current.map((item) => (item.id === result.data.id ? result.data : item))
          )
        );
        showNotice(
          `${result.data.name} is now ${result.data.enabled ? 'enabled' : 'disabled'}.`
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The agent could not be updated.');
    } finally {
      setUpdatingIds((current) => {
        const next = new Set(current);
        next.delete(agent.id);
        return next;
      });
    }
  };

  const hasFilters = Boolean(query.trim()) || statusFilter !== 'all';

  return (
    <AppShell
      actions={
        canManage ? (
          <Button
            className="min-h-11 sm:min-h-9"
            data-testid="create-agent-button"
            onClick={openCreate}
            size="sm"
          >
            <Plus aria-hidden="true" />
            New agent
          </Button>
        ) : undefined
      }
      subtitle="Create, configure, and pause the agents your team works with"
      title="Agents"
    >
      <ZoneErrorBoundary zone="agent-management">
        <main className="h-full min-h-0 overflow-y-auto" data-testid="agent-management-page">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            <div className="flex min-w-0 flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                    Agent directory
                  </h1>
                  {!canManage && !isLoading ? (
                    <Badge className="gap-1" variant="secondary">
                      <ShieldCheck aria-hidden="true" />
                      View only
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Keep team agents discoverable, describe what they do, and pause custom agents
                  without losing their profiles.
                </p>
              </div>
              <dl className="grid shrink-0 grid-cols-2 gap-x-6 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Enabled</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">
                    {numberFormat.format(counts.enabled)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Disabled</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">
                    {numberFormat.format(counts.disabled)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="mt-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <label className="sr-only" htmlFor="agent-search">
                  Search agents
                </label>
                <Input
                  aria-controls="agent-results"
                  autoCapitalize="none"
                  autoComplete="off"
                  className="h-11 pl-9 pr-10 text-base md:text-base"
                  id="agent-search"
                  name="agentSearch"
                  onChange={(event) =>
                    replaceAgentParams({
                      q: event.target.value.trim() ? event.target.value : '',
                    })
                  }
                  placeholder="Search name, handle, description, or skill…"
                  spellCheck={false}
                  type="search"
                  value={query}
                />
              </div>

              <div
                aria-label="Filter agents by availability"
                className="grid grid-cols-3 rounded-lg border bg-muted/20 p-1"
                role="group"
              >
                {(['all', 'enabled', 'disabled'] as const).map((value) => (
                  <Button
                    aria-pressed={statusFilter === value}
                    className="min-h-11 px-3 capitalize sm:min-h-9"
                    data-testid={`agent-filter-${value}`}
                    key={value}
                    onClick={() => replaceAgentParams({ status: value })}
                    size="sm"
                    variant={statusFilter === value ? 'secondary' : 'ghost'}
                  >
                    {value}
                  </Button>
                ))}
              </div>

              <Button
                aria-busy={isRefreshing}
                aria-label="Refresh agents"
                className="size-11 shrink-0 sm:size-9"
                disabled={isLoading || isRefreshing}
                onClick={() => void loadAgents(true)}
                size="icon"
                title="Refresh agents"
                variant="outline"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn(isRefreshing && 'animate-spin motion-reduce:animate-none')}
                />
              </Button>
            </div>

            <p
              aria-atomic="true"
              aria-live="polite"
              className="sr-only"
              data-testid="agent-list-status"
              role="status"
            >
              {isLoading
                ? 'Loading agents.'
                : isRefreshing
                  ? 'Refreshing agents.'
                  : formatAgentResultStatus(filteredAgents.length, agents.length, numberFormat)}
            </p>

            {notice ? (
              <div
                aria-atomic="true"
                aria-live="polite"
                className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-600/25 bg-emerald-500/5 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-300"
                data-testid="agents-notice"
                role="status"
              >
                <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
                <span className="break-words [overflow-wrap:anywhere]">{notice}</span>
              </div>
            ) : null}

            {error ? (
              <div
                aria-atomic="true"
                aria-live="assertive"
                className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
                data-testid="agents-error"
                role="alert"
              >
                <span className="inline-flex min-w-0 items-start gap-2">
                  <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span className="break-words [overflow-wrap:anywhere]">{error}</span>
                </span>
                <Button
                  className="min-h-11 sm:min-h-8"
                  onClick={() => void loadAgents(true)}
                  size="sm"
                  variant="ghost"
                >
                  Retry
                </Button>
              </div>
            ) : null}

            <section
              aria-busy={isLoading || isRefreshing}
              aria-label="Agents"
              className="mt-5"
              id="agent-results"
            >
              {isLoading ? (
                <AgentListLoading />
              ) : filteredAgents.length > 0 ? (
                <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                  {filteredAgents.map((agent) => (
                    <AgentCard
                      agent={agent}
                      canManage={canManage}
                      key={agent.id}
                      onEdit={openEdit}
                      onToggleEnabled={(item) => void toggleEnabled(item)}
                      updating={updatingIds.has(agent.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed px-5 py-12 text-center">
                  <span className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Bot aria-hidden="true" className="size-5" />
                  </span>
                  <h2 className="mt-4 text-sm font-semibold">
                    {hasFilters ? 'No matching agents' : 'No agents yet'}
                  </h2>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                    {hasFilters
                      ? 'Try another search or show all availability states.'
                      : canManage
                        ? 'Create an agent profile to make it available to your team.'
                        : 'There are no agent profiles available to this organization.'}
                  </p>
                  {hasFilters ? (
                    <Button
                      className="mt-4 min-h-11 sm:min-h-9"
                      onClick={() => replaceAgentParams({ q: '', status: 'all' })}
                      size="sm"
                      variant="outline"
                    >
                      Clear filters
                    </Button>
                  ) : canManage ? (
                    <Button className="mt-4 min-h-11 sm:min-h-9" onClick={openCreate} size="sm">
                      <Plus aria-hidden="true" />
                      Create agent
                    </Button>
                  ) : null}
                </div>
              )}
            </section>
          </div>
        </main>

        <AgentEditorDialog
          agent={editingAgent}
          canManage={canManage}
          onOpenChange={setEditorOpen}
          onSaved={handleSaved}
          open={editorOpen}
        />
      </ZoneErrorBoundary>
    </AppShell>
  );
}

function AgentListLoading() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {[0, 1, 2].map((item) => (
        <div
          aria-hidden="true"
          className="animate-pulse rounded-xl border bg-card p-5 motion-reduce:animate-none"
          key={item}
        >
          <div className="h-4 w-2/5 rounded bg-muted" />
          <div className="mt-3 h-3 w-1/4 rounded bg-muted" />
          <div className="mt-5 h-3 w-4/5 rounded bg-muted" />
          <div className="mt-2 h-3 w-3/5 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function formatAgentResultStatus(visible: number, total: number, numberFormat: Intl.NumberFormat) {
  const noun = total === 1 ? 'agent' : 'agents';
  return `Showing ${numberFormat.format(visible)} of ${numberFormat.format(total)} ${noun}.`;
}

function sortAgents(agents: AgentProfileDtoV1[]) {
  return [...agents].sort((left, right) => {
    if (left.builtin !== right.builtin) return left.builtin ? -1 : 1;
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function readAgentStatusFilter(value: string | null): StatusFilter {
  return AGENT_STATUS_FILTERS.has(value as StatusFilter) ? (value as StatusFilter) : 'all';
}

function isDefaultAgentParam(key: AgentParamKey, value: string) {
  if (key === 'q') {
    return value.trim().length === 0;
  }

  return value === 'all';
}
