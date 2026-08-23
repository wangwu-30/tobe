import type { RoomAgentMentionV1 } from '@/agent/room-runtime/contracts';

export type RoomMentionAgent = {
  handle: string;
  id: string;
};

export type RoomComposerDraft = {
  mentions: readonly RoomAgentMentionV1[];
  text: string;
};

export type RoomTextSelection = {
  end: number;
  start: number;
};

export type RoomMentionInsertion = {
  caret: number;
  draft: RoomComposerDraft;
};

/**
 * Applies a textarea edit while preserving mention identity only when the
 * complete, authoritative handle token remains untouched. Raw @text never
 * becomes routing data through this function.
 */
export function applyRoomTextEdit(
  draft: RoomComposerDraft,
  nextText: string
): RoomComposerDraft {
  if (draft.text === nextText) return draft;

  const edit = findSingleTextEdit(draft.text, nextText);
  const delta = edit.nextEnd - edit.oldEnd;
  const mentions = draft.mentions
    .map((mention) => {
      if (mention.range.end <= edit.start) return mention;
      if (mention.range.start >= edit.oldEnd) {
        return {
          ...mention,
          range: {
            end: mention.range.end + delta,
            start: mention.range.start + delta,
          },
        };
      }
      return null;
    })
    .filter((mention): mention is RoomAgentMentionV1 => mention !== null)
    .filter((mention) => mentionMatchesText(mention, nextText));

  return { mentions: sortMentions(mentions), text: nextText };
}

/** Inserts one registry-backed handle and records its UTF-16 textarea range. */
export function insertRoomMention(
  draft: RoomComposerDraft,
  agent: RoomMentionAgent,
  selection: RoomTextSelection
): RoomMentionInsertion {
  const existing = draft.mentions.find(
    (mention) => mention.agentId === agent.id
  );
  if (existing) {
    return { caret: existing.range.end, draft };
  }

  const start = clamp(selection.start, 0, draft.text.length);
  const end = clamp(selection.end, start, draft.text.length);
  const prefix =
    start === end && start > 0 && !/\s/.test(draft.text.charAt(start - 1))
      ? ' '
      : '';
  const suffix = needsTrailingSpace(draft.text, end) ? ' ' : '';
  const replacement = `${prefix}${agent.handle}${suffix}`;
  const nextText =
    draft.text.slice(0, start) + replacement + draft.text.slice(end);
  const delta = replacement.length - (end - start);
  const shifted = draft.mentions
    .map((mention) => {
      if (mention.range.end <= start) return mention;
      if (mention.range.start >= end) {
        return {
          ...mention,
          range: {
            end: mention.range.end + delta,
            start: mention.range.start + delta,
          },
        };
      }
      return null;
    })
    .filter((mention): mention is RoomAgentMentionV1 => mention !== null);
  const mention: RoomAgentMentionV1 = {
    agentId: agent.id,
    handle: agent.handle,
    range: {
      start: start + prefix.length,
      end: start + prefix.length + agent.handle.length,
    },
    type: 'agent',
  };

  return {
    caret: start + replacement.length,
    draft: {
      mentions: sortMentions([...shifted, mention]),
      text: nextText,
    },
  };
}

export function removeRoomMention(
  draft: RoomComposerDraft,
  agentId: string
): RoomMentionInsertion {
  const mention = draft.mentions.find((item) => item.agentId === agentId);
  if (!mention) return { caret: draft.text.length, draft };

  const removeEnd =
    draft.text.charAt(mention.range.end) === ' '
      ? mention.range.end + 1
      : mention.range.end;
  const nextText =
    draft.text.slice(0, mention.range.start) + draft.text.slice(removeEnd);
  const removedLength = removeEnd - mention.range.start;
  const mentions = draft.mentions
    .filter((item) => item.agentId !== agentId)
    .map((item) =>
      item.range.start >= removeEnd
        ? {
            ...item,
            range: {
              end: item.range.end - removedLength,
              start: item.range.start - removedLength,
            },
          }
        : item
    )
    .filter((item) => mentionMatchesText(item, nextText));

  return {
    caret: mention.range.start,
    draft: { mentions: sortMentions(mentions), text: nextText },
  };
}

/** Returns only ranges that still point at their exact registry handle. */
export function getValidRoomMentions(
  draft: RoomComposerDraft
): RoomAgentMentionV1[] {
  const seen = new Set<string>();
  return sortMentions(
    draft.mentions.filter((mention) => {
      if (seen.has(mention.agentId) || !mentionMatchesText(mention, draft.text)) {
        return false;
      }
      seen.add(mention.agentId);
      return true;
    })
  );
}

/** Finds the active @ query immediately before a textarea caret. */
export function findRoomMentionQuery(
  text: string,
  caret: number
): (RoomTextSelection & { query: string }) | null {
  const safeCaret = clamp(caret, 0, text.length);
  const prefix = text.slice(0, safeCaret);
  const match = /(?:^|\s)(@[^\s@]*)$/.exec(prefix);
  if (!match) return null;

  const token = match[1];
  return {
    end: safeCaret,
    query: token.slice(1),
    start: safeCaret - token.length,
  };
}

function findSingleTextEdit(previous: string, next: string) {
  let start = 0;
  const sharedLength = Math.min(previous.length, next.length);
  while (start < sharedLength && previous[start] === next[start]) start += 1;

  let suffix = 0;
  while (
    suffix < previous.length - start &&
    suffix < next.length - start &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) {
    suffix += 1;
  }

  return {
    nextEnd: next.length - suffix,
    oldEnd: previous.length - suffix,
    start,
  };
}

function mentionMatchesText(mention: RoomAgentMentionV1, text: string) {
  return (
    Number.isInteger(mention.range.start) &&
    Number.isInteger(mention.range.end) &&
    mention.range.start >= 0 &&
    mention.range.end > mention.range.start &&
    mention.range.end <= text.length &&
    text.slice(mention.range.start, mention.range.end).toLocaleLowerCase() ===
      mention.handle.toLocaleLowerCase()
  );
}

function sortMentions(mentions: readonly RoomAgentMentionV1[]) {
  return [...mentions].sort(
    (left, right) => left.range.start - right.range.start
  );
}

function needsTrailingSpace(text: string, insertionEnd: number) {
  const nextCharacter = text.charAt(insertionEnd);
  return !nextCharacter || !/\s/.test(nextCharacter);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
