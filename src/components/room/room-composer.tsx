'use client';

import * as React from 'react';
import {
  AtSign,
  Bot,
  Check,
  CornerDownLeft,
  LoaderCircle,
  SendHorizontal,
  Sparkles,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { RoomAgent } from '@/lib/room/client';
import {
  applyRoomTextEdit,
  findRoomMentionQuery,
  getValidRoomMentions,
  insertRoomMention,
  removeRoomMention,
  type RoomComposerDraft,
  type RoomTextSelection,
} from '@/lib/room/mentions';
import type { RoomMessageDtoV1 } from '@/objects/room';

export type RoomComposerSubmitValue = {
  mentions: RoomComposerDraft['mentions'];
  replyToMessageId: string | null;
  text: string;
};

export type RoomComposerProps = {
  agents: readonly RoomAgent[];
  disabled?: boolean;
  hostAgentId: string | null;
  onCancelReply?: () => void;
  onSubmit: (value: RoomComposerSubmitValue) => boolean | Promise<boolean>;
  replyTo?: RoomMessageDtoV1 | null;
};

const EMPTY_DRAFT: RoomComposerDraft = { mentions: [], text: '' };

export function normalizeRoomComposerOptionIndex(
  requestedIndex: number,
  optionCount: number
) {
  if (optionCount <= 0) return -1;
  return ((requestedIndex % optionCount) + optionCount) % optionCount;
}

export function getNextRoomComposerOptionIndex(
  currentIndex: number,
  optionCount: number,
  direction: -1 | 1
) {
  if (optionCount <= 0) return -1;
  return normalizeRoomComposerOptionIndex(
    currentIndex + direction,
    optionCount
  );
}

export function RoomComposer({
  agents,
  disabled = false,
  hostAgentId,
  onCancelReply,
  onSubmit,
  replyTo = null,
}: RoomComposerProps) {
  const [draft, setDraft] = React.useState<RoomComposerDraft>(EMPTY_DRAFT);
  const [selection, setSelection] = React.useState<RoomTextSelection>({
    end: 0,
    start: 0,
  });
  const [agentMenuOpen, setAgentMenuOpen] = React.useState(false);
  const [activeAgentIndex, setActiveAgentIndex] = React.useState(0);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const agentOptionRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const messageInputId = React.useId();
  const agentMenuId = React.useId();
  const agentMenuHeadingId = React.useId();
  const composerHintId = React.useId();
  const mentionStatusId = React.useId();
  const selectedAgentIds = React.useMemo(
    () => new Set(draft.mentions.map((mention) => mention.agentId)),
    [draft.mentions]
  );
  const mentionQuery = React.useMemo(
    () => findRoomMentionQuery(draft.text, selection.end),
    [draft.text, selection.end]
  );
  const filteredAgents = React.useMemo(() => {
    const query = (mentionQuery?.query || '').toLocaleLowerCase();
    return agents.filter(
      (agent) =>
        agent.enabled &&
        (!query ||
          `${agent.name} ${agent.handle} ${agent.skills.join(' ')}`
            .toLocaleLowerCase()
            .includes(query))
    );
  }, [agents, mentionQuery?.query]);
  const host = agents.find((agent) => agent.id === hostAgentId) || null;

  React.useEffect(() => {
    if (mentionQuery) {
      setActiveAgentIndex(0);
      setAgentMenuOpen(true);
    }
  }, [mentionQuery]);

  React.useEffect(() => {
    if (!agentMenuOpen) return;
    setActiveAgentIndex((current) => {
      if (filteredAgents.length === 0) return 0;
      return normalizeRoomComposerOptionIndex(current, filteredAgents.length);
    });
  }, [agentMenuOpen, filteredAgents.length]);

  React.useEffect(() => {
    if (!draft.text.trim() || isSubmitting) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [draft.text, isSubmitting]);

  const resizeTextarea = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 176)}px`;
  }, []);

  React.useEffect(resizeTextarea, [draft.text, resizeTextarea]);

  const updateSelection = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setSelection({
      end: textarea.selectionEnd,
      start: textarea.selectionStart,
    });
  }, []);

  const focusAt = React.useCallback((caret: number) => {
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
      setSelection({ end: caret, start: caret });
    });
  }, []);

  const selectAgent = React.useCallback(
    (agent: RoomAgent) => {
      if (selectedAgentIds.has(agent.id)) {
        const result = removeRoomMention(draft, agent.id);
        setDraft(result.draft);
        setAgentMenuOpen(Boolean(mentionQuery));
        focusAt(result.caret);
        return;
      }

      const insertionRange = mentionQuery || selection;
      const result = insertRoomMention(draft, agent, insertionRange);
      setDraft(result.draft);
      setAgentMenuOpen(false);
      focusAt(result.caret);
    },
    [draft, focusAt, mentionQuery, selectedAgentIds, selection]
  );

  const submit = React.useCallback(async () => {
    if (disabled || isSubmitting || !draft.text.trim()) return;
    const mentions = getValidRoomMentions(draft);
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const accepted = await onSubmit({
        mentions,
        replyToMessageId: replyTo?.messageId || null,
        text: draft.text,
      });
      if (!accepted) {
        setSubmitError('消息未发送，请检查连接后重试。');
        return;
      }
      setDraft(EMPTY_DRAFT);
      setSelection({ end: 0, start: 0 });
      onCancelReply?.();
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch {
      setSubmitError('消息发送失败，请检查连接后重试。');
    } finally {
      setIsSubmitting(false);
      requestAnimationFrame(() =>
        textareaRef.current?.focus({ preventScroll: true })
      );
    }
  }, [disabled, draft, isSubmitting, onCancelReply, onSubmit, replyTo?.messageId]);

  const focusAgentOption = React.useCallback(
    (nextIndex: number) => {
      const normalizedIndex = normalizeRoomComposerOptionIndex(
        nextIndex,
        filteredAgents.length
      );
      if (normalizedIndex < 0) return;
      setActiveAgentIndex(normalizedIndex);
      agentOptionRefs.current[normalizedIndex]?.focus();
    },
    [filteredAgents.length]
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape' && agentMenuOpen) {
        event.preventDefault();
        setAgentMenuOpen(false);
        return;
      }
      if (
        (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
        agentMenuOpen &&
        filteredAgents.length > 0
      ) {
        event.preventDefault();
        focusAgentOption(
          event.key === 'ArrowDown'
            ? Math.max(0, activeAgentIndex)
            : filteredAgents.length - 1
        );
        return;
      }
      if (
        event.key === 'Enter' &&
        (event.metaKey || event.ctrlKey) &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        void submit();
      }
    },
    [activeAgentIndex, agentMenuOpen, filteredAgents.length, focusAgentOption, submit]
  );

  const moveAgentOptionFocus = React.useCallback(
    (currentIndex: number, direction: -1 | 1) => {
      const nextIndex = getNextRoomComposerOptionIndex(
        currentIndex,
        filteredAgents.length,
        direction
      );
      if (nextIndex < 0) return;
      agentOptionRefs.current[nextIndex]?.focus();
      setActiveAgentIndex(nextIndex);
    },
    [filteredAgents.length]
  );

  return (
    <div className="border-t bg-background px-3 pb-3 pt-2 sm:px-5 sm:pb-5">
      <form
        className="mx-auto max-w-3xl overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 motion-reduce:transition-none"
        data-testid="room-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {replyTo ? (
          <div className="flex items-start gap-2 border-b bg-muted/35 px-3 py-2 text-xs">
            <CornerDownLeft className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <span className="font-medium">回复 {actorName(replyTo)}</span>
              <p className="mt-0.5 truncate text-muted-foreground">
                {replyTo.text}
              </p>
            </div>
            <button
              aria-label="取消回复"
              className="-mr-2 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:-mr-1 sm:size-7"
              onClick={onCancelReply}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}

        {draft.mentions.length > 0 ? (
          <div
            aria-label="已选择的 Agent"
            className="flex flex-wrap gap-1.5 px-3 pt-3"
          >
            {draft.mentions.map((mention) => {
              const agent = agents.find((item) => item.id === mention.agentId);
              return (
                <button
                  aria-label={`移除 ${agent?.name || mention.handle}`}
                  className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-full bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 motion-reduce:transition-none dark:bg-violet-950/40 dark:text-violet-300 sm:min-h-7"
                  key={mention.agentId}
                  onClick={() => {
                    const result = removeRoomMention(draft, mention.agentId);
                    setDraft(result.draft);
                    focusAt(result.caret);
                  }}
                  type="button"
                >
                  <Bot className="size-3" />
                  <span className="truncate">{agent?.name || mention.handle}</span>
                  <X className="size-3" />
                </button>
              );
            })}
          </div>
        ) : null}

        <label className="sr-only" htmlFor={messageInputId}>
          Room 消息
        </label>
        <textarea
          aria-busy={isSubmitting}
          aria-describedby={`${composerHintId} ${mentionStatusId}`}
          aria-invalid={Boolean(submitError)}
          autoComplete="off"
          className="block min-h-20 w-full resize-none bg-transparent px-3 py-3 text-base leading-6 outline-none placeholder:text-muted-foreground/70 disabled:opacity-60 sm:text-sm"
          data-testid="room-message-input"
          disabled={disabled}
          id={messageInputId}
          maxLength={100000}
          name="roomMessage"
          onChange={(event) => {
            setDraft((current) => applyRoomTextEdit(current, event.target.value));
            setSelection({
              end: event.target.selectionEnd,
              start: event.target.selectionStart,
            });
          }}
          onClick={updateSelection}
          onKeyDown={handleKeyDown}
          onKeyUp={updateSelection}
          placeholder={
            host
              ? `和 ${host.name} 协调，或用 @ 选择专业 Agent…`
              : '发送消息，或用 @ 选择专业 Agent…'
          }
          readOnly={isSubmitting}
          ref={textareaRef}
          value={draft.text}
        />

        <div className="flex items-center justify-between gap-3 border-t px-2 py-2">
          <div className="flex min-w-0 items-center gap-1">
            <Popover open={agentMenuOpen} onOpenChange={setAgentMenuOpen}>
              <PopoverTrigger asChild>
                <Button
                  aria-controls={agentMenuOpen ? agentMenuId : undefined}
                  aria-expanded={agentMenuOpen}
                  aria-haspopup="listbox"
                  aria-label="选择 Agent"
                  className="text-muted-foreground"
                  onKeyDown={(event) => {
                    if (
                      (event.key === 'ArrowDown' ||
                        event.key === 'ArrowUp' ||
                        event.key === 'Enter' ||
                        event.key === ' ') &&
                      filteredAgents.length > 0
                    ) {
                      event.preventDefault();
                      setAgentMenuOpen(true);
                      requestAnimationFrame(() =>
                        focusAgentOption(
                          event.key === 'ArrowUp'
                            ? filteredAgents.length - 1
                            : activeAgentIndex
                        )
                      );
                    }
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <AtSign />
                  <span className="hidden sm:inline">选择 Agent</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[min(20rem,calc(100vw-1.5rem))] p-1.5"
                id={agentMenuId}
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  if (mentionQuery) return;
                  requestAnimationFrame(() => focusAgentOption(activeAgentIndex));
                }}
                side="top"
              >
                <div
                  className="px-2 pb-1.5 pt-1 text-xs font-medium text-foreground"
                  id={agentMenuHeadingId}
                >
                  选择 Agent
                </div>
                <div className="px-2 pb-1.5 text-xs text-muted-foreground">
                  可同时选择多个 Agent；选择后会写入结构化 mention。
                </div>
                <div
                  aria-labelledby={agentMenuHeadingId}
                  aria-multiselectable="true"
                  className="max-h-64 overflow-y-auto overscroll-contain"
                  role="listbox"
                >
                  {filteredAgents.length ? (
                    filteredAgents.map((agent, index) => (
                      <div
                        aria-selected={selectedAgentIds.has(agent.id)}
                        className="flex min-h-11 w-full cursor-pointer touch-manipulation items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        key={agent.id}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault();
                            moveAgentOptionFocus(
                              index,
                              event.key === 'ArrowDown' ? 1 : -1
                            );
                          } else if (event.key === 'Home') {
                            event.preventDefault();
                            focusAgentOption(0);
                          } else if (event.key === 'End') {
                            event.preventDefault();
                            focusAgentOption(filteredAgents.length - 1);
                          } else if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectAgent(agent);
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            setAgentMenuOpen(false);
                            textareaRef.current?.focus();
                          } else if (event.key === 'Tab') {
                            setAgentMenuOpen(false);
                          }
                        }}
                        onClick={() => selectAgent(agent)}
                        onFocus={() => setActiveAgentIndex(index)}
                        ref={(element) => {
                          agentOptionRefs.current[index] = element;
                        }}
                        role="option"
                        tabIndex={index === activeAgentIndex ? 0 : -1}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground',
                            agent.id === hostAgentId &&
                              'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                          )}
                        >
                          {agent.id === hostAgentId ? (
                            <Sparkles className="size-3.5" />
                          ) : (
                            <Bot className="size-3.5" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                            <span className="truncate">{agent.name}</span>
                            {agent.id === hostAgentId ? (
                              <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
                                协调者
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {agent.handle}
                            {agent.description ? ` · ${agent.description}` : ''}
                          </span>
                        </span>
                        {selectedAgentIds.has(agent.id) ? (
                          <Check className="mt-1 size-4 text-violet-600" />
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div
                      className="px-2 py-5 text-center text-xs text-muted-foreground"
                      role="status"
                    >
                      没有匹配的 Agent
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <span className="hidden truncate text-xs text-muted-foreground md:inline">
              {draft.mentions.length === 0
                ? '未点名时由协调 Agent 回应'
                : `${draft.mentions.length} 位 Agent 将收到消息`}
            </span>
            <span className="sr-only" id={composerHintId}>
              输入 @ 可筛选 Agent 候选；按方向键进入候选列表，Command 或 Control 加 Enter 发送。
            </span>
            <span aria-live="polite" className="sr-only" id={mentionStatusId}>
              {agentMenuOpen && mentionQuery
                ? filteredAgents.length > 0
                  ? `已打开 Agent 候选，共 ${filteredAgents.length} 项。`
                  : '没有匹配的 Agent。'
                : ''}
            </span>
            <span aria-live="polite" className="sr-only">
              {draft.mentions.length === 0
                ? '未选择 Agent，将由协调 Agent 回应。'
                : `已选择 ${draft.mentions.length} 位 Agent。`}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              ⌘&nbsp;/&nbsp;Ctrl&nbsp;+&nbsp;Enter 发送
            </span>
            <Button
              aria-busy={isSubmitting}
              aria-label={isSubmitting ? '正在发送消息…' : '发送消息'}
              data-testid="room-send-button"
              disabled={disabled || isSubmitting || !draft.text.trim()}
              size="icon-sm"
              type="submit"
            >
              {isSubmitting ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : (
                <SendHorizontal />
              )}
            </Button>
          </div>
        </div>
        <p
          aria-live="polite"
          className="min-h-0 break-words px-3 text-xs text-destructive empty:hidden"
          role={submitError ? 'alert' : undefined}
        >
          {submitError}
        </p>
      </form>
    </div>
  );
}

function actorName(message: RoomMessageDtoV1) {
  if (message.actor.type === 'human') {
    return message.actor.displayName || '你';
  }
  if (message.actor.type === 'agent') {
    return message.actor.displayName || message.actor.handle;
  }
  return '系统';
}
