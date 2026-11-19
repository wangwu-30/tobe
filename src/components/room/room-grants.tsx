'use client';

import * as React from 'react';
import { KeyRound, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';

import { useT } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  issueRoomDelegationGrant,
  revokeRoomDelegationGrant,
  type RoomAgent,
} from '@/lib/room/client';
import type { RoomDelegationGrantDtoV1, RoomEventDtoV1 } from '@/objects/room';

type GrantStatus = RoomDelegationGrantDtoV1['status'];

type VisibleGrant = {
  createdAt: string;
  fromAgentId: string;
  id: string;
  scope: RoomDelegationGrantDtoV1['scope'];
  status: GrantStatus;
  targetAgentId: string;
};

export type RoomGrantsProps = {
  agents: readonly RoomAgent[];
  events: readonly RoomEventDtoV1[];
  hostAgentId: string | null;
  roomId: string;
};

export function RoomGrants({
  agents,
  events,
  hostAgentId,
  roomId,
}: RoomGrantsProps) {
  const t = useT();
  const enabledAgents = React.useMemo(
    () => agents.filter((agent) => agent.enabled),
    [agents]
  );
  const defaultSourceId = enabledAgents.some((agent) => agent.id === hostAgentId)
    ? hostAgentId || ''
    : enabledAgents[0]?.id || '';
  const [fromAgentId, setFromAgentId] = React.useState(defaultSourceId);
  const [targetAgentId, setTargetAgentId] = React.useState('');
  const [scope, setScope] = React.useState<'once' | 'room'>('once');
  const [localGrants, setLocalGrants] = React.useState<
    Map<string, RoomDelegationGrantDtoV1>
  >(() => new Map());
  const [pendingGrantId, setPendingGrantId] = React.useState<string | null>(null);
  const [isIssuing, setIsIssuing] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [noticeTone, setNoticeTone] = React.useState<'error' | 'status'>('status');
  const [confirmGrantId, setConfirmGrantId] = React.useState<string | null>(null);
  const mutationInFlightRef = React.useRef(false);
  const sourceId = enabledAgents.some((agent) => agent.id === fromAgentId)
    ? fromAgentId
    : defaultSourceId;
  const targetOptions = enabledAgents.filter((agent) => agent.id !== sourceId);
  const selectedTargetId = targetOptions.some(
    (agent) => agent.id === targetAgentId
  )
    ? targetAgentId
    : targetOptions[0]?.id || '';
  const grants = React.useMemo(
    () => mergeVisibleGrants(events, localGrants),
    [events, localGrants]
  );
  const agentNames = React.useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents]
  );
  const sourceLabelId = React.useId();
  const targetLabelId = React.useId();
  const scopeLabelId = React.useId();
  const confirmedGrant = grants.find((grant) => grant.id === confirmGrantId) || null;

  React.useEffect(() => {
    setFromAgentId(defaultSourceId);
    setTargetAgentId('');
    setScope('once');
    setLocalGrants(new Map());
    setPendingGrantId(null);
    setIsIssuing(false);
    setNotice('');
    setNoticeTone('status');
    setConfirmGrantId(null);
    mutationInFlightRef.current = false;
  }, [defaultSourceId, roomId]);

  async function issueGrant() {
    if (mutationInFlightRef.current) return;
    if (!sourceId || !selectedTargetId || sourceId === selectedTargetId) {
      setNotice(t('room.grantsSameAgentError'));
      setNoticeTone('error');
      return;
    }
    setIsIssuing(true);
    mutationInFlightRef.current = true;
    setNotice('');
    setNoticeTone('status');
    try {
      const result = await issueRoomDelegationGrant(roomId, {
        fromAgentId: sourceId,
        scope,
        targetAgentId: selectedTargetId,
      });
      if (!result.ok) {
        setNotice(t('room.grantsIssueError', { error: result.error }));
        setNoticeTone('error');
        return;
      }
      setLocalGrants((current) => {
        const next = new Map(current);
        next.set(result.data.id, result.data);
        return next;
      });
      setNotice(t('room.grantsIssuedNotice'));
    } catch {
      setNotice(t('room.grantsIssueNetworkError'));
      setNoticeTone('error');
    } finally {
      mutationInFlightRef.current = false;
      setIsIssuing(false);
    }
  }

  async function revokeGrant(grantId: string) {
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setPendingGrantId(grantId);
    setNotice('');
    setNoticeTone('status');
    try {
      const result = await revokeRoomDelegationGrant(roomId, grantId);
      if (!result.ok) {
        setNotice(t('room.grantsRevokeError', { error: result.error }));
        setNoticeTone('error');
        return;
      }
      setLocalGrants((current) => {
        const next = new Map(current);
        next.set(result.data.id, result.data);
        return next;
      });
      setNotice(t('room.grantsRevokedNotice'));
      setConfirmGrantId(null);
    } catch {
      setNotice(t('room.grantsRevokeNetworkError'));
      setNoticeTone('error');
    } finally {
      mutationInFlightRef.current = false;
      setPendingGrantId(null);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={t('room.grantsTriggerAria')}
          size="icon-sm"
          title={t('room.grantsTitle')}
          type="button"
          variant="ghost"
        >
          <ShieldCheck />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(24rem,calc(100vw-1.5rem))] p-0 motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none"
      >
        <div className="border-b p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-balance">
            <KeyRound className="size-4" />
            {t('room.grantsTitle')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('room.grantsDescription')}
          </p>
        </div>

        <form
          className="grid gap-3 border-b p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void issueGrant();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label id={sourceLabelId}>{t('room.grantsFromLabel')}</Label>
              <Select name="fromAgentId" value={sourceId} onValueChange={setFromAgentId}>
                <SelectTrigger aria-labelledby={sourceLabelId} className="w-full">
                  <SelectValue placeholder={t('room.grantsSelectAgent')} />
                </SelectTrigger>
                <SelectContent>
                  {enabledAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label id={targetLabelId}>{t('room.grantsTargetLabel')}</Label>
              <Select
                name="targetAgentId"
                value={selectedTargetId}
                onValueChange={setTargetAgentId}
              >
                <SelectTrigger aria-labelledby={targetLabelId} className="w-full">
                  <SelectValue placeholder={t('room.grantsSelectAgent')} />
                </SelectTrigger>
                <SelectContent>
                  {targetOptions.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label id={scopeLabelId}>{t('room.grantsScopeLabel')}</Label>
            <Select
              name="scope"
              value={scope}
              onValueChange={(value) => setScope(value as 'once' | 'room')}
            >
              <SelectTrigger aria-labelledby={scopeLabelId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="once">{t('room.grantsScopeOnce')}</SelectItem>
                <SelectItem value="room">{t('room.grantsScopeRoom')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            aria-busy={isIssuing}
            disabled={isIssuing || !sourceId || !selectedTargetId}
            size="sm"
            type="submit"
          >
            {isIssuing ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
            {isIssuing ? t('room.grantsCreating') : t('room.grantsCreate')}
          </Button>
          {enabledAgents.length < 2 ? (
            <p className="text-xs text-muted-foreground">
              {t('room.grantsNeedTwoAgents')}
            </p>
          ) : null}
          <p
            className={
              noticeTone === 'error'
                ? 'min-h-4 break-words text-xs text-destructive'
                : 'min-h-4 break-words text-xs text-muted-foreground'
            }
          >
            {notice}
          </p>
        </form>

        <div className="max-h-72 overflow-y-auto overscroll-contain p-2">
          <p className="px-2 py-1 text-xs font-medium">{t('room.grantsListTitle')}</p>
          {grants.length ? (
            <ul className="space-y-1">
              {grants.map((grant) => {
                const fromName = agentNames.get(grant.fromAgentId) || grant.fromAgentId;
                const targetName = agentNames.get(grant.targetAgentId) || grant.targetAgentId;
                return (
                  <li className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2" key={grant.id}>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-xs font-medium [overflow-wrap:anywhere]">
                        {fromName}
                        {' → '}
                        {targetName}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {grant.scope === 'once' ? t('room.grantsScopeOnce') : t('room.grantsScopeRoom')} · {statusLabel(grant.status, t)}
                      </span>
                    </span>
                    {grant.status === 'active' ? (
                      <Button
                        aria-label={t('room.grantsRevokeAria', {
                          from: fromName,
                          target: targetName,
                        })}
                        disabled={pendingGrantId !== null}
                        onClick={() => setConfirmGrantId(grant.id)}
                        size="icon-xs"
                        title={t('room.grantsRevokeTitle')}
                        type="button"
                        variant="ghost"
                      >
                        {pendingGrantId === grant.id ? (
                          <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                        ) : (
                          <Trash2 />
                        )}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2 py-5 text-center text-xs text-muted-foreground">
              {t('room.grantsEmpty')}
            </p>
          )}
        </div>
      </PopoverContent>
      <Dialog
        onOpenChange={(open) => {
          if (!open && pendingGrantId === null) setConfirmGrantId(null);
        }}
        open={Boolean(confirmedGrant)}
      >
        <DialogContent
          className="motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none"
          onEscapeKeyDown={(event) => {
            if (pendingGrantId) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (pendingGrantId) event.preventDefault();
          }}
          showCloseButton={!pendingGrantId}
        >
          <DialogHeader>
            <DialogTitle>{t('room.grantsRevokeDialogTitle')}</DialogTitle>
            <DialogDescription className="break-words">
              {confirmedGrant
                ? t('room.grantsRevokeDialogDesc', {
                    from: agentNames.get(confirmedGrant.fromAgentId) || confirmedGrant.fromAgentId,
                    target: agentNames.get(confirmedGrant.targetAgentId) || confirmedGrant.targetAgentId,
                  })
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {noticeTone === 'error' && notice ? (
              <p className="mb-2 break-words text-sm text-destructive sm:mb-0 sm:mr-auto">
                {notice}
              </p>
            ) : null}
            <DialogClose asChild>
              <Button disabled={Boolean(pendingGrantId)} type="button" variant="outline">
                {t('room.grantsCancel')}
              </Button>
            </DialogClose>
            <Button
              aria-busy={Boolean(pendingGrantId)}
              disabled={!confirmedGrant || Boolean(pendingGrantId)}
              onClick={() => {
                if (confirmedGrant) void revokeGrant(confirmedGrant.id);
              }}
              type="button"
              variant="destructive"
            >
              {pendingGrantId ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : null}
              {pendingGrantId ? t('room.grantsRevoking') : t('room.grantsRevokeTitle')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <span
        aria-atomic="true"
        aria-live={noticeTone === 'error' ? 'assertive' : 'polite'}
        className="sr-only"
        role={noticeTone === 'error' && notice ? 'alert' : 'status'}
      >
        {notice}
      </span>
    </Popover>
  );
}

function mergeVisibleGrants(
  events: readonly RoomEventDtoV1[],
  localGrants: ReadonlyMap<string, RoomDelegationGrantDtoV1>
): VisibleGrant[] {
  const grants = new Map<string, VisibleGrant>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (!isEventData(event.data)) continue;
    const grantId = stringField(event.data, 'grantId');
    if (!grantId) continue;
    if (event.type === 'delegation_grant.issued') {
      const fromAgentId = stringField(event.data, 'fromAgentId');
      const targetAgentId = stringField(event.data, 'targetAgentId');
      const scope = event.data.scope;
      if (fromAgentId && targetAgentId && (scope === 'once' || scope === 'room')) {
        grants.set(grantId, {
          createdAt: event.createdAt,
          fromAgentId,
          id: grantId,
          scope,
          status: 'active',
          targetAgentId,
        });
      }
    } else if (event.type === 'delegation_grant.revoked') {
      updateStatus(grants, grantId, 'revoked');
    } else if (event.type === 'delegation.accepted') {
      const grant = grants.get(grantId);
      if (grant?.scope === 'once') updateStatus(grants, grantId, 'consumed');
    }
  }
  for (const grant of localGrants.values()) {
    const durableGrant = grants.get(grant.id);
    if (
      grant.status === 'active' &&
      durableGrant &&
      durableGrant.status !== 'active'
    ) continue;
    grants.set(grant.id, {
      createdAt: grant.createdAt,
      fromAgentId: grant.fromAgentId,
      id: grant.id,
      scope: grant.scope,
      status: grant.status,
      targetAgentId: grant.targetAgentId,
    });
  }
  return [...grants.values()].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
}

function isEventData(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string) {
  return typeof value[field] === 'string' ? value[field] : null;
}

function updateStatus(
  grants: Map<string, VisibleGrant>,
  grantId: string,
  status: GrantStatus
) {
  const grant = grants.get(grantId);
  if (grant) grants.set(grantId, { ...grant, status });
}

function statusLabel(status: GrantStatus, t: ReturnType<typeof useT>) {
  if (status === 'active') return t('room.grantsStatusActive');
  if (status === 'consumed') return t('room.grantsStatusConsumed');
  return t('room.grantsStatusRevoked');
}
