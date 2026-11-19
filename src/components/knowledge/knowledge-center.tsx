'use client';

import * as React from 'react';
import { ArrowRight, GitBranch, Info, RefreshCw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { ZoneErrorBoundary } from '@/framework/resilience';
import { useAppRouter, useAppSearchParams } from '@/lib/app-router';
import { useT } from '@/components/providers/language-provider';
import {
  getKnowledgeChangeRequestClient,
  getKnowledgeActorSummaryClient,
  listKnowledgeAgentsClient,
  listKnowledgeBindingsClient,
  listKnowledgeChangeRequestsClient,
  listKnowledgeSpacesClient,
  listKnowledgeWorkspacesClient,
  queueKnowledgeMergeClient,
  reviewKnowledgeChangeRequestClient,
  type KnowledgeChangeRequestDetail,
  type KnowledgeWorkspaceOption,
} from '@/lib/knowledge/client';
import type { KnowledgeBindingDto, KnowledgeChangeRequestDto, KnowledgeSpaceDto } from '@/objects/knowledge';
import type { AgentProfileData } from '@/types';

import { KnowledgeConfiguration } from './knowledge-configuration';
import { KnowledgeNotice } from './knowledge-presentation';
import { KnowledgeReviewWorkspace } from './knowledge-review';

type View = 'reviews' | 'configuration';
type BusyAction = 'approve' | 'merge' | 'reject' | null;
type PrimaryErrors = { bindings: string | null; changes: string | null; spaces: string | null };
const ACTIVE_OPERATION_STATUSES = new Set(['queued', 'running']);
const EMPTY_PRIMARY_ERRORS: PrimaryErrors = { bindings: null, changes: null, spaces: null };

export function KnowledgeCenter() {
  const t = useT();
  const tRef = React.useRef(t);
  React.useEffect(() => {
    tRef.current = t;
  }, [t]);
  const router = useAppRouter();
  const searchParams = useAppSearchParams();
  const view: View = searchParams.get('view') === 'configuration' ? 'configuration' : 'reviews';
  const requestedChangeId = searchParams.get('change');
  const changeRequestRef = React.useRef(requestedChangeId);
  changeRequestRef.current = requestedChangeId;
  const [changes, setChanges] = React.useState<KnowledgeChangeRequestDto[]>([]);
  const [changesLoaded, setChangesLoaded] = React.useState(false);
  const [spaces, setSpaces] = React.useState<KnowledgeSpaceDto[]>([]);
  const [bindings, setBindings] = React.useState<KnowledgeBindingDto[]>([]);
  const [agents, setAgents] = React.useState<AgentProfileData[]>([]);
  const [workspaces, setWorkspaces] = React.useState<KnowledgeWorkspaceOption[]>([]);
  const [detail, setDetail] = React.useState<KnowledgeChangeRequestDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = React.useState(true);
  const [busyAction, setBusyAction] = React.useState<BusyAction>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [primaryErrors, setPrimaryErrors] = React.useState<PrimaryErrors>(EMPTY_PRIMARY_ERRORS);
  const [optionsError, setOptionsError] = React.useState<string | null>(null);
  const [pollError, setPollError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [proposerAgentId, setProposerAgentId] = React.useState<string | null>(null);
  const [proposalGoal, setProposalGoal] = React.useState<string | null>(null);
  const selectedIdRef = React.useRef<string | null>(null);
  const detailRef = React.useRef<KnowledgeChangeRequestDetail | null>(null);
  const explicitFocusDetailIdRef = React.useRef<string | null>(null);

  const selectedId = React.useMemo(() => {
    if (view !== 'reviews') return null;
    if (requestedChangeId && (!changesLoaded || changes.some((change) => change.id === requestedChangeId))) {
      return requestedChangeId;
    }
    return changes[0]?.id ?? null;
  }, [changes, changesLoaded, requestedChangeId, view]);

  React.useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  React.useEffect(() => { detailRef.current = detail; }, [detail]);

  const loadPrimary = React.useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setChangesLoaded(false);
    }

    try {
      const [changeResult, spaceResult, bindingResult] = await Promise.all([
        listKnowledgeChangeRequestsClient(),
        listKnowledgeSpacesClient(),
        listKnowledgeBindingsClient(),
      ]);
      if (changeResult.ok) {
        setChanges(changeResult.data);
        setChangesLoaded(true);
        const activeRequestedId = changeRequestRef.current;
        if (activeRequestedId && changeResult.data.some((change) => change.id === activeRequestedId)) {
          selectedIdRef.current = activeRequestedId;
        } else {
          selectedIdRef.current = changeResult.data[0]?.id ?? null;
        }
      }

      if (spaceResult.ok) setSpaces(spaceResult.data);
      if (bindingResult.ok) setBindings(bindingResult.data);
      setPrimaryErrors({
        bindings: bindingResult.ok ? null : bindingResult.error,
        changes: changeResult.ok ? null : changeResult.error,
        spaces: spaceResult.ok ? null : spaceResult.error,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : tRef.current('knowledge.loadFailed');
      setPrimaryErrors({ bindings: message, changes: message, spaces: message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadOptions = React.useCallback(async (background = false) => {
    if (!background) setOptionsLoading(true);
    try {
      const [agentResult, workspaceResult] = await Promise.all([
        listKnowledgeAgentsClient(),
        listKnowledgeWorkspacesClient(),
      ]);
      if (agentResult.ok) setAgents(agentResult.data);
      if (workspaceResult.ok) setWorkspaces(workspaceResult.data);
      const failures = [
        !agentResult.ok ? tRef.current('knowledge.optionsAgentsPrefix', { error: agentResult.error }) : null,
        !workspaceResult.ok ? tRef.current('knowledge.optionsDeliverablesPrefix', { error: workspaceResult.error }) : null,
      ].filter((message): message is string => Boolean(message));
      setOptionsError(
        failures.length
          ? tRef.current('knowledge.optionsPartialFailed', { details: failures.join(' ') })
          : null
      );
    } catch (caught) {
      setOptionsError(caught instanceof Error ? caught.message : tRef.current('knowledge.optionsLoadFailed'));
    } finally {
      if (!background) setOptionsLoading(false);
    }
  }, []);

  const loadDetail = React.useCallback(async (id: string, background = false) => {
    if (!background) {
      setDetail(null);
      detailRef.current = null;
      setDetailError(null);
      setDetailLoading(true);
    }
    try {
      const result = await getKnowledgeChangeRequestClient(id);
      if (selectedIdRef.current === id) {
        if (result.ok) {
          setDetail(result.data);
          detailRef.current = result.data;
          setDetailError(null);
          setPollError(null);
          setChanges((current) => current.map((change) => change.id === id ? result.data.changeRequest : change));
        } else if (background) {
          setPollError(result.error);
        } else {
          setDetailError(result.error);
        }
      }
      return result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : tRef.current('knowledge.detailLoadFailed');
      if (selectedIdRef.current === id) {
        if (background) setPollError(message);
        else setDetailError(message);
      }
      return { ok: false, error: message } as const;
    } finally {
      if (selectedIdRef.current === id) setDetailLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void Promise.all([loadPrimary(), loadOptions()]);
  }, [loadOptions, loadPrimary]);

  React.useEffect(() => {
    if (view !== 'reviews' || !changesLoaded || primaryErrors.changes) return;
    if (requestedChangeId === selectedId && searchParams.get('view') === 'reviews') return;
    router.replace(knowledgeHref('reviews', selectedId), { scroll: false });
  }, [changesLoaded, primaryErrors.changes, requestedChangeId, router, searchParams, selectedId, view]);

  React.useEffect(() => {
    if (!changesLoaded) return;
    if (!selectedId) {
      setDetail(null);
      detailRef.current = null;
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    void loadDetail(selectedId);
  }, [changesLoaded, loadDetail, selectedId]);

  React.useEffect(() => {
    if (!detail || explicitFocusDetailIdRef.current !== detail.changeRequest.id) return;
    explicitFocusDetailIdRef.current = null;
    window.requestAnimationFrame(() => {
      document.getElementById('knowledge-review-detail-heading')?.focus();
    });
  }, [detail]);

  React.useEffect(() => {
    const jobId = detail?.changeRequest.jobId;
    if (!jobId) {
      setProposerAgentId(null);
      setProposalGoal(null);
      return;
    }
    let alive = true;
    void getKnowledgeActorSummaryClient(jobId).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setProposerAgentId(result.data.agentId);
        setProposalGoal(result.data.goal);
      } else {
        setProposerAgentId(null);
        setProposalGoal(null);
      }
    });
    return () => { alive = false; };
  }, [detail?.changeRequest.jobId]);

  const proposerLabel = React.useMemo(() => {
    if (!proposerAgentId) return null;
    const agent = agents.find((item) => item.id === proposerAgentId);
    return agent?.name || t('knowledge.agentFallback', { id: proposerAgentId.slice(0, 8) });
  }, [agents, proposerAgentId, t]);

  const shouldPoll = Boolean(
    detail &&
      ((detail.changeRequest.status === 'merged' &&
        detail.activeSnapshot?.commitSha !== detail.changeRequest.headCommit) ||
        detail.mergeOperations.some((operation) =>
          ACTIVE_OPERATION_STATUSES.has(operation.status)
        ))
  );
  const pollDelayMs = shouldPoll
    ? (detail?.mergeOperations[0]?.status === 'queued' ? 1_000 : 2_000)
    : null;

  React.useEffect(() => {
    if (!selectedId || pollDelayMs === null) return;
    const poll = window.setTimeout(() => {
      void loadDetail(selectedId, true);
    }, pollDelayMs);
    return () => window.clearTimeout(poll);
  }, [loadDetail, pollDelayMs, selectedId]);

  const refresh = React.useCallback(async () => {
    setError(null);
    setDetailError(null);
    setPollError(null);
    await Promise.all([loadPrimary({ background: true }), loadOptions(true)]);
    const currentId = selectedIdRef.current;
    if (currentId) await loadDetail(currentId, true);
  }, [loadDetail, loadOptions, loadPrimary]);

  const refreshDetail = React.useCallback(async (id: string) => {
    setPollError(null);
    await loadDetail(id, true);
    await loadPrimary({ background: true });
  }, [loadDetail, loadPrimary]);

  const review = async (action: 'approve' | 'reject', note: string): Promise<boolean> => {
    const currentDetail = detailRef.current;
    if (!currentDetail) return false;
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      const result = await reviewKnowledgeChangeRequestClient(currentDetail.changeRequest.id, {
        action,
        expectedRevision: currentDetail.changeRequest.revision,
        note: note.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setNotice(action === 'approve' ? t('knowledge.approveNotice') : t('knowledge.rejectNotice'));
      explicitFocusDetailIdRef.current = result.data.id;
      await refreshDetail(result.data.id);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('knowledge.reviewSaveFailed'));
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const merge = async (): Promise<boolean> => {
    const currentDetail = detailRef.current;
    if (!currentDetail) return false;
    setBusyAction('merge');
    setError(null);
    setNotice(null);
    try {
      const result = await queueKnowledgeMergeClient(currentDetail.changeRequest.id, currentDetail.changeRequest.revision);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setNotice(t('knowledge.mergeQueuedNotice'));
      explicitFocusDetailIdRef.current = currentDetail.changeRequest.id;
      await refreshDetail(currentDetail.changeRequest.id);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('knowledge.mergeQueueFailed'));
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <AppShell
      title={t('knowledge.title')}
      subtitle={t('knowledge.subtitle')}
      actions={
        <Button
          aria-busy={refreshing}
          aria-label={refreshing ? t('knowledge.refreshingAria') : t('knowledge.refreshAria')}
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading || refreshing}
        >
          <RefreshCw aria-hidden="true" className={refreshing ? 'motion-safe:animate-spin' : ''} />
          {refreshing ? t('knowledge.refreshing') : t('knowledge.refresh')}
        </Button>
      }
    >
      <ZoneErrorBoundary zone="knowledge-center">
        <main className="h-full min-w-0 touch-pan-y overflow-y-auto overscroll-y-contain">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            <header className="max-w-3xl">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{t('knowledge.eyebrow')}</div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{t('knowledge.headline')}</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('knowledge.lead')}</p>
            </header>

            <aside
              aria-labelledby="knowledge-boundary-title"
              className="mt-4 flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/30 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between"
              data-testid="knowledge-boundary-guide"
            >
              <div className="flex min-w-0 items-start gap-3">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground" id="knowledge-boundary-title">
                    {t('knowledge.boundaryTitle')}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t('knowledge.boundaryBody')}
                  </p>
                </div>
              </div>
              <Button asChild className="shrink-0 self-start sm:self-center" size="sm" variant="outline">
                <Link href="/">
                  {t('knowledge.boundaryWikiLink')}
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </Button>
            </aside>

            <nav className="mt-6 flex flex-col gap-2 border-b pb-4 sm:flex-row" aria-label={t('knowledge.viewsNavAria')}>
              <Button asChild className="w-full justify-start sm:w-auto" data-testid="knowledge-reviews-tab" variant={view === 'reviews' ? 'secondary' : 'ghost'}>
                <Link aria-current={view === 'reviews' ? 'page' : undefined} href={knowledgeHref('reviews', selectedId || requestedChangeId)} scroll={false}>
                  <ShieldCheck aria-hidden="true" /> {t('knowledge.tabReviews')}
                </Link>
              </Button>
              <Button asChild className="w-full justify-start sm:w-auto" data-testid="knowledge-configuration-tab" variant={view === 'configuration' ? 'secondary' : 'ghost'}>
                <Link aria-current={view === 'configuration' ? 'page' : undefined} href={knowledgeHref('configuration', selectedId)} scroll={false}>
                  <GitBranch aria-hidden="true" /> {t('knowledge.tabConfiguration')}
                </Link>
              </Button>
            </nav>
            {busyAction || refreshing ? (
              <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {busyAction === 'approve'
                  ? t('knowledge.liveApproving')
                  : busyAction === 'reject'
                    ? t('knowledge.liveRejecting')
                    : busyAction === 'merge'
                      ? t('knowledge.liveQueueingMerge')
                      : t('knowledge.liveRefreshing')}
              </div>
            ) : null}
            {notice ? <KnowledgeNotice tone="success" onDismiss={() => setNotice(null)}>{notice}</KnowledgeNotice> : null}
            {error ? <KnowledgeNotice tone="error" onDismiss={() => setError(null)}>{error}</KnowledgeNotice> : null}
            {view === 'reviews' ? (
              <KnowledgeReviewWorkspace
                busyAction={busyAction}
                changes={changes}
                detail={detail}
                detailError={detailError}
                detailLoading={detailLoading}
                loading={loading}
                onMerge={merge}
                onRefresh={refresh}
                onReview={review}
                onSelect={() => {}}
                pollError={pollError}
                proposalGoal={proposalGoal}
                proposerLabel={proposerLabel}
                queueError={primaryErrors.changes}
                selectedId={selectedId}
              />
            ) : (
              <KnowledgeConfiguration
                agents={agents}
                bindings={bindings}
                loading={loading}
                loadingOptions={optionsLoading}
                onChanged={async (message) => { setNotice(message); setError(null); await Promise.all([loadPrimary({ background: true }), loadOptions(true)]); }}
                onError={setError}
                onRetry={refresh}
                optionsError={optionsError}
                bindingsError={primaryErrors.bindings}
                spaces={spaces}
                spacesError={primaryErrors.spaces}
                workspaces={workspaces}
              />
            )}
          </div>
        </main>
      </ZoneErrorBoundary>
    </AppShell>
  );
}

function knowledgeHref(view: View, changeId?: string | null) {
  const params = new URLSearchParams({ view });
  if (changeId) params.set('change', changeId);
  return `/knowledge?${params.toString()}`;
}
