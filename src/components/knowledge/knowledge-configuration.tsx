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
    'You have unsaved Knowledge configuration. Leave without saving it?'
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
        await onChanged('Knowledge repository added and verified.');
      } else {
        onError(result.error);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Knowledge repository could not be added.');
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
      onError('Agent-owned repositories must be bound to their owning agent.');
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
        await onChanged('Workspace knowledge binding added.');
      } else {
        onError(result.error);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Workspace binding could not be added.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="mt-6 grid min-w-0 gap-6 xl:grid-cols-2" aria-label="Knowledge configuration">
      {busyAction ? (
        <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
          {busyAction === 'space'
            ? 'Verifying and adding Knowledge repository.'
            : 'Adding workspace Knowledge binding.'}
        </p>
      ) : null}
      <div className="min-w-0 rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><FolderGit2 aria-hidden="true" className="size-4" /></div>
          <div>
            <h2 className="font-semibold">Knowledge repositories</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Register a local Git repository first. The path and branch are verified; credentials and remote URLs are never collected here.
            </p>
          </div>
        </div>

        <form aria-busy={busyAction === 'space'} className="mt-5 grid gap-4" onSubmit={(event) => void createSpace(event)}>
          <Field label="Ownership" htmlFor="knowledge-scope">
            <Select
              disabled={busyAction !== null}
              name="scope"
              onValueChange={(value) => {
                setScope(value as 'team' | 'agent');
                if (value === 'team') setOwnerAgentId('');
              }}
              value={scope}
            >
              <SelectTrigger aria-label="Ownership" className="w-full" id="knowledge-scope" data-testid="knowledge-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="team"><Users aria-hidden="true" /> Team shared</SelectItem>
                <SelectItem value="agent"><Bot aria-hidden="true" /> Agent owned</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {scope === 'agent' ? (
            <Field
              description={!loadingOptions && agents.length === 0 ? 'No agents are available. Add an agent in Settings before creating an agent-owned repository.' : undefined}
              descriptionId="knowledge-owner-agent-help"
              label="Owner agent"
              htmlFor="knowledge-owner-agent"
            >
              <Select
                disabled={busyAction !== null || loadingOptions || agents.length === 0}
                name="ownerAgentId"
                onValueChange={setOwnerAgentId}
                value={ownerAgentId}
              >
                <SelectTrigger aria-describedby={!loadingOptions && agents.length === 0 ? 'knowledge-owner-agent-help' : undefined} aria-label="Owner agent" className="w-full" id="knowledge-owner-agent" data-testid="knowledge-owner-agent">
                  <SelectValue placeholder={loadingOptions ? 'Loading agents…' : 'Select an agent'} />
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

          <Field label="Local repository path" htmlFor="knowledge-repo-path">
            <Input
              id="knowledge-repo-path"
              name="repositoryPath"
              required
              type="text"
              data-testid="knowledge-repo-path"
              disabled={busyAction !== null}
              value={repoPath}
              onChange={(event) => setRepoPath(event.target.value)}
              placeholder="Example: /srv/knowledge/team-repository…"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>

          <Field label="Default branch" htmlFor="knowledge-default-branch">
            <Input
              id="knowledge-default-branch"
              name="defaultBranch"
              required
              type="text"
              data-testid="knowledge-default-branch"
              disabled={busyAction !== null}
              value={defaultBranch}
              onChange={(event) => setDefaultBranch(event.target.value)}
              placeholder="Example: main…"
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
            {busyAction === 'space' ? 'Verifying and adding repository…' : 'Verify and add repository'}
          </Button>
        </form>

        <div className="mt-6 space-y-2" data-testid="knowledge-space-list">
          {loading ? (
            <LoadingConfigState text="Loading repositories…" />
          ) : spacesError && spaces.length === 0 ? (
            <ErrorConfigState onRetry={onRetry} text={spacesError} />
          ) : spaces.length === 0 ? (
            <EmptyConfigState text="No repositories configured yet. Add one to make reviewed knowledge available." />
          ) : spaces.map((space) => (
            <div key={space.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{spaceLabel(space, agents)}</div>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground" title={space.repoPath || 'Local repository'}>{space.repoPath || 'Local repository'}</p>
                </div>
                <Badge className="max-w-[45%] shrink-0 break-all whitespace-normal" title={space.defaultBranch} variant="outline">{space.defaultBranch}</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {space.activeSnapshotId ? 'Active index ready for retrieval' : 'Awaiting its first reviewed and indexed change'}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><Users aria-hidden="true" className="size-4" /></div>
          <div>
            <h2 className="font-semibold">Workspace access</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Then connect one repository to a deliverable. Team repositories use team access; agent repositories must match their owner.
            </p>
          </div>
        </div>

        {optionsError ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300" role="alert">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{optionsError}</span>
            <Button onClick={() => void onRetry()} size="sm" variant="outline"><RefreshCw aria-hidden="true" /> Retry choices</Button>
          </div>
        ) : null}

        <form aria-busy={busyAction === 'binding'} className="mt-5 grid gap-4" onSubmit={(event) => void createBinding(event)}>
          <Field
            description={!loadingOptions && workspaces.length === 0 ? 'No deliverables are available. Create one before adding a binding.' : undefined}
            descriptionId="knowledge-workspace-help"
            label="Deliverable"
            htmlFor="knowledge-workspace"
          >
            <Select disabled={busyAction !== null || loadingOptions || workspaces.length === 0} name="workspaceId" onValueChange={setWorkspaceId} value={workspaceId}>
              <SelectTrigger aria-describedby={!loadingOptions && workspaces.length === 0 ? 'knowledge-workspace-help' : undefined} aria-label="Deliverable" className="w-full" id="knowledge-workspace" data-testid="knowledge-workspace">
                <SelectValue placeholder={loadingOptions ? 'Loading deliverables…' : 'Select a deliverable'} />
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

          <Field label="Repository" htmlFor="knowledge-binding-space">
            <Select disabled={busyAction !== null || spaces.length === 0} name="spaceId" onValueChange={setSpaceId} value={spaceId}>
              <SelectTrigger aria-label="Repository" className="w-full" id="knowledge-binding-space" data-testid="knowledge-binding-space">
                <SelectValue placeholder="Select a repository…" />
              </SelectTrigger>
              <SelectContent>
                {spaces.map((space) => (
                  <SelectItem key={space.id} value={space.id}>
                    {spaceLabel(space, agents)} · {space.defaultBranch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            description={missingBindingOwner ? 'The repository owner is unavailable. Restore that agent before binding this repository.' : undefined}
            descriptionId="knowledge-binding-agent-error"
            error={missingBindingOwner}
            label="Applies to"
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
                aria-label="Applies to"
                className="w-full"
                id="knowledge-binding-agent"
                data-testid="knowledge-binding-agent"
              >
                <SelectValue placeholder="Select access owner…" />
              </SelectTrigger>
              <SelectContent>
                {!selectedBindingSpace || selectedBindingSpace.scope === 'team' ? (
                  <SelectItem value={TEAM_BINDING_VALUE}>Team</SelectItem>
                ) : eligibleBindingAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}{agent.handle ? ` · ${formatHandle(agent.handle)}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Permission" htmlFor="knowledge-access">
            <Select disabled={busyAction !== null} name="access" onValueChange={(value) => setAccess(value as 'read' | 'propose')} value={access}>
              <SelectTrigger aria-label="Permission" className="w-full" id="knowledge-access" data-testid="knowledge-access"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="propose">Read and propose changes</SelectItem>
                <SelectItem value="read">Read only</SelectItem>
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
            {busyAction === 'binding' ? 'Adding workspace binding…' : 'Add workspace binding'}
          </Button>
        </form>

        <div className="mt-6 space-y-2" data-testid="knowledge-binding-list">
          {loading ? (
            <LoadingConfigState text="Loading workspace bindings…" />
          ) : bindingsError && bindings.length === 0 ? (
            <ErrorConfigState onRetry={onRetry} text={bindingsError} />
          ) : bindings.length === 0 ? (
            <EmptyConfigState text="No workspace bindings yet. Connect a repository after it is registered." />
          ) : bindings.map((binding) => {
            const workspace = workspaces.find((item) => item.id === binding.workspaceId);
            const agent = agents.find((item) => item.id === binding.agentId);
            const space = spaces.find((item) => item.id === binding.spaceId);
            return (
              <div key={binding.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="break-words font-medium" title={workspace?.title || `Deliverable ${binding.workspaceId}`}>{workspace?.title || `Deliverable ${shortId(binding.workspaceId)}`}</div>
                    <p className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {space ? spaceLabel(space, agents) : `Repository ${shortId(binding.spaceId)}`} · {agent ? agent.name : 'Team'}
                    </p>
                  </div>
                  <Badge className="shrink-0" variant="outline">{binding.access === 'propose' ? 'Can propose' : 'Read only'}</Badge>
                </div>
                <p className="mt-2 break-all text-xs text-muted-foreground" title={binding.mountPath}>Repository root mounted at {binding.mountPath}</p>
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

function ErrorConfigState({ onRetry, text }: { onRetry: () => Promise<void> | void; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive" role="alert">
      <p className="break-words [overflow-wrap:anywhere]">{text}</p>
      <Button onClick={() => void onRetry()} size="sm" variant="outline"><RefreshCw aria-hidden="true" /> Try again</Button>
    </div>
  );
}

function formatHandle(handle: string) {
  return handle.startsWith('@') ? handle : `@${handle}`;
}

function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function spaceLabel(space: KnowledgeSpaceDto, agents: AgentProfileData[]) {
  if (space.scope === 'team') return 'Team knowledge';
  const owner = agents.find((agent) => agent.id === space.ownerAgentId);
  return owner ? `${owner.name}'s knowledge` : `Agent knowledge · ${shortId(space.ownerAgentId || '')}`;
}
