'use client';

import * as React from 'react';
import { Bot, Sparkles } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { CommentAgentConfigData } from '@/types';

type MentionState = {
  query: string;
  start: number;
};

type CommentAgentTextareaProps = Omit<
  React.ComponentProps<typeof Textarea>,
  'onChange' | 'value'
> & {
  agents: CommentAgentConfigData[];
  onChange: (value: string) => void;
  suggestionsPlacement?: 'above' | 'below';
  value: string;
};

function readMentionState(value: string, caretPosition: number): MentionState | null {
  const prefix = value.slice(0, caretPosition);
  const atIndex = prefix.lastIndexOf('@');
  if (atIndex < 0) {
    return null;
  }

  const beforeAt = prefix[atIndex - 1];
  if (beforeAt && !/\s|\(|\[|{"|'/.test(beforeAt)) {
    return null;
  }

  const query = prefix.slice(atIndex + 1);
  if (/\s/.test(query)) {
    return null;
  }

  return {
    query: query.toLowerCase(),
    start: atIndex,
  };
}

export const CommentAgentTextarea = React.forwardRef<
  HTMLTextAreaElement,
  CommentAgentTextareaProps
>(function CommentAgentTextarea(
  {
    agents,
    className,
    onChange,
    onKeyDown,
    suggestionsPlacement = 'below',
    value,
    ...props
  },
  forwardedRef
) {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const generatedId = React.useId();
  const textareaId = props.id || `comment-agent-textarea-${generatedId}`;
  const listboxId = `${textareaId}-agent-suggestions`;
  const [mentionState, setMentionState] = React.useState<MentionState | null>(null);
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement, []);

  const visibleAgents = React.useMemo(() => {
    const enabledAgents = agents.filter((agent) => agent.enabled);
    if (!mentionState) {
      return [];
    }

    const query = mentionState.query.trim();
    if (!query) {
      return enabledAgents;
    }

    return enabledAgents.filter((agent) => {
      const handle = agent.handle.replace(/^@/, '');
      return handle.includes(query) || agent.name.toLowerCase().includes(query);
    });
  }, [agents, mentionState]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [mentionState?.query]);

  const commitMention = React.useCallback(
    (agent: CommentAgentConfigData) => {
      const textarea = innerRef.current;
      if (!textarea || !mentionState) {
        return;
      }

      const nextValue = `${value.slice(0, mentionState.start)}${agent.handle} ${value.slice(
        textarea.selectionStart
      )}`;
      onChange(nextValue);
      setMentionState(null);

      requestAnimationFrame(() => {
        const caret = mentionState.start + agent.handle.length + 1;
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
      });
    },
    [mentionState, onChange, value]
  );

  return (
    <div className="relative">
      <Textarea
        {...props}
        aria-activedescendant={
          mentionState && visibleAgents.length > 0
            ? `${listboxId}-option-${visibleAgents[selectedIndex]?.id || visibleAgents[0].id}`
            : undefined
        }
        aria-controls={mentionState && visibleAgents.length > 0 ? listboxId : undefined}
        aria-expanded={mentionState ? visibleAgents.length > 0 : undefined}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        autoComplete={props.autoComplete || 'off'}
        className={cn(className)}
        id={textareaId}
        name={props.name || 'comment'}
        ref={innerRef}
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue);
          setMentionState(readMentionState(nextValue, event.target.selectionStart));
        }}
        onClick={(event) => {
          const target = event.currentTarget;
          setMentionState(readMentionState(target.value, target.selectionStart));
          props.onClick?.(event);
        }}
        onKeyDown={(event) => {
          if (mentionState && visibleAgents.length > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSelectedIndex((current) => (current + 1) % visibleAgents.length);
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelectedIndex((current) =>
                current === 0 ? visibleAgents.length - 1 : current - 1
              );
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              commitMention(visibleAgents[selectedIndex] || visibleAgents[0]);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setMentionState(null);
              return;
            }
          }

          onKeyDown?.(event);
        }}
      />

      {mentionState && visibleAgents.length > 0 ? (
        <div
          aria-label="Comment agent suggestions"
          className={cn(
            'absolute left-0 right-0 z-20 overflow-hidden rounded-2xl border border-border/80 bg-background shadow-xl',
            suggestionsPlacement === 'above'
              ? 'bottom-full mb-2'
              : 'top-full mt-2'
          )}
          id={listboxId}
          role="listbox"
        >
          <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
            输入 `@角色` 立即加入回复监听
          </div>
          <div className="max-h-56 overflow-y-auto p-1.5">
            {visibleAgents.map((agent, index) => (
              <button
                key={agent.id}
                className={cn(
                  'flex min-h-11 w-full touch-manipulation items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                  index === selectedIndex ? 'bg-muted' : 'hover:bg-muted/60'
                )}
                id={`${listboxId}-option-${agent.id}`}
                role="option"
                aria-selected={index === selectedIndex}
                tabIndex={-1}
                type="button"
                onClick={() => commitMention(agent)}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
              >
                <div className="mt-0.5 rounded-full bg-primary/10 p-1 text-primary">
                  <Bot aria-hidden="true" className="h-3 w-3" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {agent.name}
                  </div>
                  <div className="text-xs text-muted-foreground">{agent.handle}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});
