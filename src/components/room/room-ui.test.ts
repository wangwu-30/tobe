import { expect, test } from '@playwright/test';

import {
  findRoomMentionQuery,
  insertRoomMention,
  type RoomComposerDraft,
} from '@/lib/room/mentions';

import {
  getNextRoomComposerOptionIndex,
  normalizeRoomComposerOptionIndex,
} from './room-composer';
import {
  getRoomFeedUnreadIncrement,
  isRoomFeedNearBottom,
} from './room-feed';

const ANALYST = {
  builtin: true,
  description: 'Investigates details',
  enabled: true,
  handle: '@analyst',
  id: 'agent-analyst',
  name: 'Analyst',
  skills: ['research', 'analysis'],
};

test('room feed near-bottom detection matches the unread-entry threshold', () => {
  expect(
    isRoomFeedNearBottom({
      clientHeight: 400,
      scrollHeight: 1000,
      scrollTop: 520,
    })
  ).toBe(true);

  expect(
    isRoomFeedNearBottom({
      clientHeight: 400,
      scrollHeight: 1000,
      scrollTop: 500,
    })
  ).toBe(false);
});

test('room feed unread increment only grows when the user is off-bottom after initial hydration', () => {
  expect(
    getRoomFeedUnreadIncrement({
      announcementReady: false,
      nextDurableItemCount: 4,
      previousDurableItemCount: 2,
      shouldStickToBottom: false,
    })
  ).toBe(0);

  expect(
    getRoomFeedUnreadIncrement({
      announcementReady: true,
      nextDurableItemCount: 5,
      previousDurableItemCount: 3,
      shouldStickToBottom: true,
    })
  ).toBe(0);

  expect(
    getRoomFeedUnreadIncrement({
      announcementReady: true,
      nextDurableItemCount: 5,
      previousDurableItemCount: 3,
      shouldStickToBottom: false,
    })
  ).toBe(2);
});

test('room composer keyboard index helpers wrap through the standalone listbox', () => {
  expect(normalizeRoomComposerOptionIndex(0, 3)).toBe(0);
  expect(normalizeRoomComposerOptionIndex(4, 3)).toBe(1);
  expect(normalizeRoomComposerOptionIndex(-1, 3)).toBe(2);
  expect(normalizeRoomComposerOptionIndex(0, 0)).toBe(-1);

  expect(getNextRoomComposerOptionIndex(0, 3, 1)).toBe(1);
  expect(getNextRoomComposerOptionIndex(2, 3, 1)).toBe(0);
  expect(getNextRoomComposerOptionIndex(0, 3, -1)).toBe(2);
  expect(getNextRoomComposerOptionIndex(0, 0, 1)).toBe(-1);
});

test('typed mention queries still resolve to the same structured insertion path', () => {
  const draft: RoomComposerDraft = {
    mentions: [],
    text: '请 @ana',
  };
  const query = findRoomMentionQuery(draft.text, draft.text.length);

  expect(query).toEqual({
    end: draft.text.length,
    query: 'ana',
    start: 2,
  });

  const inserted = insertRoomMention(draft, ANALYST, query!);
  expect(inserted.draft.text).toBe('请 @analyst ');
  expect(inserted.draft.mentions).toEqual([
    {
      agentId: ANALYST.id,
      handle: ANALYST.handle,
      range: { end: 10, start: 2 },
      type: 'agent',
    },
  ]);
});
