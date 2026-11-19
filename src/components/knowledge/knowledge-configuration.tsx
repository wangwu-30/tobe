'use client';

import * as React from 'react';
import { Bot, FolderGit2, LoaderCircle, Plus, RefreshCw, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createKnowledgeBindingClient,
  createKnowledgeSpaceClient,
  type KnowledgeWorkspaceOption,
} from '@/lib/knowledge/client';
import { useT } from '@/components/providers/language-provider';
import type { KnowledgeBindingDto, KnowledgeSpaceDto } from '@/objects/knowledge';
import type { AgentProfileData } from '@/types';

import { useUnsavedChangesWarning } from './knowledge-presentation';

const TEAM_BINDING_VALUE = '__team__';

export function KnowledgeConfiguration({
  agents,
  bindings,
  bindingsError,
  loading,
  loadingOptions,
  onChanged,
  onError,
  onRetry,
  optionsError,
  spaces,
  spacesError,
  workspaces,
}: {
  agents: AgentProfileData[];
  bindings: KnowledgeBindingDto[];
  bindingsError: string | null;
  loading: boolean;
  loadingOptions: boolean;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string | null) => void;
  onRetry: () => Promise<void> | void;
  optionsError: string | null;
  spaces: KnowledgeSpaceDto[];
  spacesError: string | null;
  workspaces: KnowledgeWorkspaceOption[];
}) {
  const t = useT();
  const [scope, setScope] = React.useState<'team' | 'agent'>('team');
  const [repoPath, setRepoPath] = React.useState('');
  const [defaultBranch, setDefaultBranch] = React.useState('main');
  const [ownerAgentId, setOwnerAgentId] = React.useState('');
  const [workspaceId, setWorkspaceId] = React.useState('');
  const [bindingAgentId, setBindingAgentId] = React.useState(TEAM_BINDING_VALUE);
  const [spaceId, setSpaceId] = React.useState('');
  const [access, setAccess] = React.useState<'read' | 'propose'>('propose');
  const [busyAction, setBusyAction] = React.useState<'binding' | 'space' | null>(null);

  const eligibleBindingAgents = React.useMemo(() => {
    const selectedSpace = spaces.find((space) => space.id === spaceId);
    if (!selectedSpace || selectedSpace.scope === 'team') return [];
    return agents.filter((agent) => agent.id === selectedSpace.ownerAgentId);
  }, [agents, spaceId, spaces]);
  const selectedBindingSpace = spaces.find((space) => space.id === spaceId);
  const missingBindingOwner = Boolean(
    selectedBindingSpace?.scope === 'agent' && eligibleBindingAgents.length === 0
  );
  const hasSelectedOwnerAgent =
    scope === 'team' || agents.some((agent) => agent.id === ownerAgentId);
  const spaceFormDirty =
    repoPath.length > 0 ||
    defaultBranch !== 'main' ||
    scope !== 'team' ||
    ownerAgentId.length > 0;
  const bindingFormDirty =
    workspaceId.length > 0 ||
    spaceId.length > 0 ||
    bindingAgentId !== TEAM_BINDING_VALUE ||
    access !== 'propose';
  useUnsavedChangesWarning(
    busyAction === null && (spaceFormDirty || bindingFormDirty),
    t('knowledge.configUnsavedWarning')
  );

  React.useEffect(() => {
    const selectedSpace = spaces.find((space) => space.id === spaceId);
    if (!selectedSpace || selectedSpace.scope === 'team') {
      setBindingAgentId(TEAM_BINDING_VALUE);
      return;
    }
    setBindingAgentId(selectedSpace.ownerAgentId || '');
  }, [spaceId, spaces]);

  const createSpace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanPath = repoPath.trim();
    const cleanBranch = defaultBranch.trim();
    if (!cleanPath || !cleanBranch || (scope === 'agent' && !ownerAgentId)) return;

    setBusyAction('space');
    onError(null);
    try {
      const result = await createKnowledgeSpaceClient({
        scope,
        repoPath: cleanPath,
        defaultBranch: cleanBranch,
        ownerAgentId: scope === 'agent' ? ownerAgentId : null,
      });
      if (result.ok) {
        setRepoPath('');
        setDefaultBranch('main');
        setSpaceId(result.data.id);
        await onChanged(t('knowledge.configSpaceAdded'));
      } else {
        onError(result.error);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : t('knowledge.configSpaceFailed'));
    } finally {
      setBusyAction(null);
    }
  };

  const createBinding = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selectedSpace = spaces.find((space) => space.id === spaceId);
    if (!workspaceId || !selectedSpace) return;
    const agentId = selectedSpace.scope === 'agent' ? bindingAgentId : TEAM_BINDING_VALUE;
    if (selectedSpace.scope === 'agent' && agentId !== selectedSpace.ownerAgentId) {
      onError(t('knowledge.configBindingOwnerMismatch'));
      return;
    }

    setBusyAction('binding');
    onError(null);
    try {
      const result = await createKnowledgeBindingClient({
        workspaceId,
        spaceId,
        agentId: agentId === TEAM_BINDING_VALUE ? null : agentId,
        access,
      });
      if (result.ok) {
        setWorkspaceId('');
        setSpaceId('');
        setBindingAgentId(TEAM_BINDING_VALUE);
        setAccess('propose');
        await onChanged(t('knowledge.configBindingAdded'));
      } else {
        onError(result.error);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : t('knowledge.configBindingFailed'));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="mt-6 grid min-w-0 gap-6 xl:grid-cols-2" aria-label={t('knowledge.configAria')}>
      {busyAction ? (
        <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
          {busyAction === 'space'
            ? t('knowledge.configLiveSpace')
            : t('knowledge.configLiveBinding')}
        </p>
      ) : null}
      <div className="min-w-0 rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><FolderGit2 aria-hidden="true" className="size-4" /></div>
          <div>
            <h2 className="font-semibold">{t('knowledge.configReposTitle')}</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {t('knowledge.configReposDescription')}
            </p>
          </div>
        </div>

        <form aria-busy={busyAction === 'space'} className="mt-5 grid gap-4" onSubmit={(event) => void createSpace(event)}>
          <Field label={t('knowledge.configOwnership')} htmlFor="knowledge-scope">
            <Select
              disabled={busyAction !== null}
              name="scope"
              onValueChange={(value) => {
                setScope(value as 'team' | 'agent');
                if (value === 'team') setOwnerAgentId('');
              }}
              value={scope}
            >
              <SelectTrigger aria-label={t('knowledge.configOwnership')} className="w-full" id="knowledge-scope" data-testid="knowledge-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="team"><Users aria-hidden="true" /> {t('knowledge.configTeamShared')}</SelectItem>
                <SelectItem value="agent"><Bot aria-hidden="true" /> {t('knowledge.configAgentOwned')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {scope === 'agent' ? (
            <Field
              description={!loadingOptions && agents.length === 0 ? t('knowledge.configNoAgentsHelp') : undefined}
              descriptionId="knowledge-owner-agent-help"
              label={t('knowledge.configOwnerAgent')}
              htmlFor="knowledge-owner-agent"
            >
              <Select
                disabled={busyAction !== null || loadingOptions || agents.length === 0}
                name="ownerAgentId"
                onValueChange={setOwnerAgentId}
                value={ownerAgentId}
              >
                <SelectTrigger aria-describedby={!loadingOptions && agents.length === 0 ? 'knowledge-owner-agent-help' : undefined} aria-label={t('knowledge.configOwnerAgent')} className="w-full" id="knowledge-owner-agent" data-testid="knowledge-owner-agent">
                  <SelectValue placeholder={loadingOptions ? t('knowledge.configLoadingAgents') : t('knowledge.configSelectAgent')} />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}{agent.handle ? ` · ${formatHandle(agent.handle)}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field label={t('knowledge.configRepoPath')} htmlFor="knowledge-repo-path">
            <Input
              id="knowledge-repo-path"
              name="repositoryPath"
              required
              type="text"
              data-testid="knowledge-repo-path"
              disabled={busyAction !== null}
              value={repoPath}
              onChange={(event) => setRepoPath(event.target.value)}
              placeholder={t('knowledge.configRepoPathPlaceholder')}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>

          <Field label={t('knowledge.configDefaultBranch')} htmlFor="knowledge-default-branch">
            <Input
              id="knowledge-default-branch"
              name="defaultBranch"
              required
              type="text"
              data-testid="knowledge-default-branch"
              disabled={busyAction !== null}
              value={defaultBranch}
              onChange={(event) => setDefaultBranch(event.target.value)}
              placeholder={t('knowledge.configDefaultBranchPlaceholder')}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>

          <Button
            aria-busy={busyAction === 'space'}
            data-testid="knowledge-add-space"
            disabled={
              busyAction !== null ||
              !repoPath.trim() ||
              !defaultBranch.trim() ||
              (scope === 'agent' && (!ownerAgentId || !hasSelectedOwnerAgent))
            }
            type="submit"
          >
            {busyAction === 'space' ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <Plus aria-hidden="true" />}
            {busyAction === 'space' ? t('knowledge.configAddingSpace') : t('knowledge.configAddSpace')}
          </Button>
        </form>

        <div className="mt-6 space-y-2" data-testid="knowledge-space-list">
          {loading ? (
            <LoadingConfigState text={t('knowledge.configSpacesLoading')} />
          ) : spacesError && spaces.length === 0 ? (
            <ErrorConfigState onRetry={onRetry} text={spacesError} retryLabel={t('knowledge.tryAgain')} />
          ) : spaces.length === 0 ? (
            <EmptyConfigState text={t('knowledge.configSpacesEmpty')} />
          ) : spaces.map((space) => (
            <div key={space.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{spaceLabel(space, agents, t)}</div>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground" title={space.repoPath || t('knowledge.configLocalRepoFallback')}>{space.repoPath || t('knowledge.configLocalRepoFallback')}</p>
                </div>
                <Badge className="max-w-[45%] shrink-0 break-all whitespace-normal" title={space.defaultBranch} variant="outline">{space.defaultBranch}</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {space.activeSnapshotId ? t('knowledge.configActiveIndexReady') : t('knowledge.configAwaitingFirstChange')}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><Users aria-hidden="true" className="size-4" /></div>
          <div>
            <h2 className="font-semibold">{t('knowledge.configAccessTitle')}</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {t('knowledge.configAccessDescription')}
            </p>
          </div>
        </div>

        {optionsError ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300" role="alert">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{optionsError}</span>
            <Button onClick={() => void onRetry()} size="sm" variant="outline"><RefreshCw aria-hidden="true" /> {t('knowledge.configRetryChoices')}</Button>
          </div>
        ) : null}

        <form aria-busy={busyAction === 'binding'} className="mt-5 grid gap-4" onSubmit={(event) => void createBinding(event)}>
          <Field
            description={!loadingOptions && workspaces.length === 0 ? t('knowledge.configNoDeliverablesHelp') : undefined}
            descriptionId="knowledge-workspace-help"
            label={t('knowledge.configDeliverable')}
            htmlFor="knowledge-workspace"
          >
            <Select disabled={busyAction !== null || loadingOptions || workspaces.length === 0} name="workspaceId" onValueChange={setWorkspaceId} value={workspaceId}>
              <SelectTrigger aria-describedby={!loadingOptions && workspaces.length === 0 ? 'knowledge-workspace-help' : undefined} aria-label={t('knowledge.configDeliverable')} className="w-full" id="knowledge-workspace" data-testid="knowledge-workspace">
                <SelectValue placeholder={loadingOptions ? t('knowledge.configLoadingDeliverables') : t('knowledge.configSelectDeliverable')} />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id}>
                    {workspace.projectTitle && workspace.projectTitle !== workspace.title
                      ? `${workspace.projectTitle} · ${workspace.title}`
                      : workspace.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t('knowledge.configRepository')} htmlFor="knowledge-binding-space">
            <Select disabled={busyAction !== null || spaces.length === 0} name="spaceId" onValueChange={setSpaceId} value={spaceId}>
              <SelectTrigger aria-label={t('knowledge.configRepository')} className="w-full" id="knowledge-binding-space" data-testid="knowledge-binding-space">
                <SelectValue placeholder={t('knowledge.configSelectRepository')} />
              </SelectTrigger>
              <SelectContent>
                {spaces.map((space) => (
                  <SelectItem key={space.id} value={space.id}>
                    {spaceLabel(space, agents, t)} · {space.defaultBranch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            description={missingBindingOwner ? t('knowledge.configMissingOwnerHelp') : undefined}
            descriptionId="knowledge-binding-agent-error"
            error={missingBindingOwner}
            label={t('knowledge.configAppliesTo')}
            htmlFor="knowledge-binding-agent"
          >
            <Select
              disabled={busyAction !== null || !spaceId}
              name="agentId"
              onValueChange={setBindingAgentId}
              value={bindingAgentId}
            >
              <SelectTrigger
                aria-describedby={missingBindingOwner ? 'knowledge-binding-agent-error' : undefined}
                aria-invalid={missingBindingOwner || undefined}
                aria-label={t('knowledge.configAppliesTo')}
                className="w-full"
                id="knowledge-binding-agent"
                data-testid="knowledge-binding-agent"
              >
                <SelectValue placeholder={t('knowledge.configSelectAccessOwner')} />
              </SelectTrigger>
              <SelectContent>
                {!selectedBindingSpace || selectedBindingSpace.scope === 'team' ? (
                  <SelectItem value={TEAM_BINDING_VALUE}>{t('knowledge.configTeamLabel')}</SelectItem>
                ) : eligibleBindingAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}{agent.handle ? ` · ${formatHandle(agent.handle)}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t('knowledge.configPermission')} htmlFor="knowledge-access">
            <Select disabled={busyAction !== null} name="access" onValueChange={(value) => setAccess(value as 'read' | 'propose')} value={access}>
              <SelectTrigger aria-label={t('knowledge.configPermission')} className="w-full" id="knowledge-access" data-testid="knowledge-access"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="propose">{t('knowledge.configAccessPropose')}</SelectItem>
                <SelectItem value="read">{t('knowledge.configAccessRead')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Button
            aria-busy={busyAction === 'binding'}
            data-testid="knowledge-add-binding"
            disabled={busyAction !== null || !workspaceId || !spaceId || missingBindingOwner || (eligibleBindingAgents.length > 0 && !bindingAgentId)}
            type="submit"
          >
            {busyAction === 'binding' ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <Plus aria-hidden="true" />}
            {busyAction === 'binding' ? t('knowledge.configAddingBinding') : t('knowledge.configAddBinding')}
          </Button>
        </form>

        <div className="mt-6 space-y-2" data-testid="knowledge-binding-list">
          {loading ? (
            <LoadingConfigState text={t('knowledge.configBindingsLoading')} />
          ) : bindingsError && bindings.length === 0 ? (
            <ErrorConfigState onRetry={onRetry} text={bindingsError} retryLabel={t('knowledge.tryAgain')} />
          ) : bindings.length === 0 ? (
            <EmptyConfigState text={t('knowledge.configBindingsEmpty')} />
          ) : bindings.map((binding) => {
            const workspace = workspaces.find((item) => item.id === binding.workspaceId);
            const agent = agents.find((item) => item.id === binding.agentId);
            const space = spaces.find((item) => item.id === binding.spaceId);
            return (
              <div key={binding.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="break-words font-medium" title={workspace?.title || t('knowledge.configDeliverableFallback', { id: binding.workspaceId })}>{workspace?.title || t('knowledge.configDeliverableFallback', { id: shortId(binding.workspaceId) })}</div>
                    <p className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {space ? spaceLabel(space, agents, t) : t('knowledge.configRepositoryFallback', { id: shortId(binding.spaceId) })} · {agent ? agent.name : t('knowledge.configTeamLabel')}
                    </p>
                  </div>
                  <Badge className="shrink-0" variant="outline">{binding.access === 'propose' ? t('knowledge.configBadgePropose') : t('knowledge.configBadgeRead')}</Badge>
                </div>
                <p className="mt-2 break-all text-xs text-muted-foreground" title={binding.mountPath}>{t('knowledge.configMountedAt', { path: binding.mountPath })}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Field({
  children,
  description,
  descriptionId,
  error = false,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  description?: string;
  descriptionId?: string;
  error?: boolean;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {description ? (
        <p className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'} id={descriptionId}>
          {description}
        </p>
      ) : null}
    </div>
  );
}

function EmptyConfigState({ text }: { text: string }) {
  return <div className="break-words rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground [overflow-wrap:anywhere]">{text}</div>;
}

function LoadingConfigState({ text }: { text: string }) {
  return <div aria-busy="true" className="flex items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground" role="status"><LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />{text}</div>;
}

function ErrorConfigState({
  onRetry,
  retryLabel,
  text,
}: {
  onRetry: () => Promise<void> | void;
  retryLabel: string;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive" role="alert">
      <p className="break-words [overflow-wrap:anywhere]">{text}</p>
      <Button onClick={() => void onRetry()} size="sm" variant="outline"><RefreshCw aria-hidden="true" /> {retryLabel}</Button>
    </div>
  );
}

function formatHandle(handle: string) {
  return handle.startsWith('@') ? handle : `@${handle}`;
}

function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function spaceLabel(
  space: KnowledgeSpaceDto,
  agents: AgentProfileData[],
  t: ReturnType<typeof useT>
) {
  if (space.scope === 'team') return t('knowledge.teamKnowledge');
  const owner = agents.find((agent) => agent.id === space.ownerAgentId);
  return owner
    ? t('knowledge.agentOwnedKnowledge', { name: owner.name })
    : t('knowledge.agentKnowledgeFallback', { id: shortId(space.ownerAgentId || '') });
}
