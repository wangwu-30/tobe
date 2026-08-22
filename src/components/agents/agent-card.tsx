'use client';

import { Bot, Check, LockKeyhole, Pencil, Power } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AgentProfileDtoV1 } from '@/lib/agents/client';

export function AgentCard({
  agent,
  canManage,
  onEdit,
  onToggleEnabled,
  updating,
}: {
  agent: AgentProfileDtoV1;
  canManage: boolean;
  onEdit: (agent: AgentProfileDtoV1) => void;
  onToggleEnabled: (agent: AgentProfileDtoV1) => void;
  updating: boolean;
}) {
  const titleId = `agent-${agent.id}-name`;
  const descriptionId = `agent-${agent.id}-description`;

  return (
    <article
      aria-busy={updating}
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={cn(
        'group min-w-0 rounded-xl border bg-card px-4 py-4 shadow-xs transition-[border-color,box-shadow,opacity] motion-reduce:transition-none sm:px-5',
        agent.enabled ? 'border-border' : 'border-dashed bg-muted/20',
        updating && 'opacity-70'
      )}
      data-agent-id={agent.id}
      data-testid={`agent-card-${agent.id}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg border',
            agent.enabled
              ? 'border-foreground/10 bg-foreground text-background'
              : 'bg-muted text-muted-foreground'
          )}
        >
          <Bot className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2
              className="min-w-0 break-words text-sm font-semibold [overflow-wrap:anywhere]"
              id={titleId}
            >
              {agent.name}
            </h2>
            <Badge
              className={cn(
                'gap-1',
                agent.enabled
                  ? 'border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'text-muted-foreground'
              )}
              data-testid={`agent-status-${agent.id}`}
              variant="outline"
            >
              {agent.enabled ? <Check aria-hidden="true" /> : <Power aria-hidden="true" />}
              {agent.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            {agent.builtin ? (
              <Badge className="gap-1" variant="secondary">
                <LockKeyhole aria-hidden="true" />
                Built-in
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground" translate="no">
            {agent.handle}
          </p>
          <p
            className="mt-3 line-clamp-3 break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]"
            id={descriptionId}
          >
            {agent.description || 'No description yet.'}
          </p>
        </div>
      </div>

      <div className="mt-4 flex min-w-0 flex-wrap gap-1.5" aria-label="Skills">
        {agent.capabilities.skills.length > 0 ? (
          agent.capabilities.skills.map((skill) => (
            <Badge
              className="max-w-full truncate font-normal"
              key={skill}
              title={skill}
              variant="outline"
            >
              {skill}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No skills listed</span>
        )}
      </div>

      <div className="mt-4 flex min-w-0 items-center justify-between gap-3 border-t pt-3">
        <p
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={agent.config.room.runtimeId}
          translate="no"
        >
          Runtime · {agent.config.room.runtimeId}
        </p>
        <div className="flex shrink-0 gap-1">
          {canManage && !agent.builtin ? (
            <Button
              aria-label={`${agent.enabled ? 'Disable' : 'Enable'} ${agent.name}`}
              className="size-11 sm:size-9"
              data-testid={`agent-toggle-${agent.id}`}
              disabled={updating}
              onClick={() => onToggleEnabled(agent)}
              size="icon"
              title={agent.enabled ? 'Disable agent' : 'Enable agent'}
              variant="ghost"
            >
              <Power aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            aria-label={`${canManage ? 'Edit' : 'View'} ${agent.name}`}
            className="min-h-11 px-3 sm:min-h-9"
            data-testid={`agent-edit-${agent.id}`}
            disabled={updating}
            onClick={() => onEdit(agent)}
            size="sm"
            variant="ghost"
          >
            <Pencil aria-hidden="true" />
            {canManage ? 'Edit' : 'View'}
          </Button>
        </div>
      </div>
    </article>
  );
}
