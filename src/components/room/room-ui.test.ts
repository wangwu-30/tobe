import assert from 'node:assert/strict';
import test from 'node:test';

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
  assert.equal(
    isRoomFeedNearBottom({
      clientHeight: 400,
      scrollHeight: 1000,
      scrollTop: 520,
    }),
    true
  );

  assert.equal(
    isRoomFeedNearBottom({
      clientHeight: 400,
      scrollHeight: 1000,
      scrollTop: 500,
    }),
    false
  );
});

test('room feed unread increment only grows when the user is off-bottom after initial hydration', () => {
  assert.equal(
    getRoomFeedUnreadIncrement({
      announcementReady: false,
      nextDurableItemCount: 4,
      previousDurableItemCount: 2,
      shouldStickToBottom: false,
    }),
    0
  );

  assert.equal(
    getRoomFeedUnreadIncrement({
      announcementReady: true,
      nextDurableItemCount: 5,
      previousDurableItemCount: 3,
      shouldStickToBottom: true,
    }),
    0
  );

  assert.equal(
    getRoomFeedUnreadIncrement({
      announcementReady: true,
      nextDurableItemCount: 5,
      previousDurableItemCount: 3,
      shouldStickToBottom: false,
    }),
    2
  );
});

test('room composer keyboard index helpers wrap through the standalone listbox', () => {
  assert.equal(normalizeRoomComposerOptionIndex(0, 3), 0);
  assert.equal(normalizeRoomComposerOptionIndex(4, 3), 1);
  assert.equal(normalizeRoomComposerOptionIndex(-1, 3), 2);
  assert.equal(normalizeRoomComposerOptionIndex(0, 0), -1);

  assert.equal(getNextRoomComposerOptionIndex(0, 3, 1), 1);
  assert.equal(getNextRoomComposerOptionIndex(2, 3, 1), 0);
  assert.equal(getNextRoomComposerOptionIndex(0, 3, -1), 2);
  assert.equal(getNextRoomComposerOptionIndex(0, 0, 1), -1);
});

test('typed mention queries still resolve to the same structured insertion path', () => {
  const draft: RoomComposerDraft = {
    mentions: [],
    text: '请 @ana',
  };
  const query = findRoomMentionQuery(draft.text, draft.text.length);

  assert.deepEqual(query, {
    end: draft.text.length,
    query: 'ana',
    start: 2,
  });

  const inserted = insertRoomMention(draft, ANALYST, query!);
  assert.equal(inserted.draft.text, '请 @analyst ');
  assert.deepEqual(inserted.draft.mentions, [
    {
      agentId: ANALYST.id,
      handle: ANALYST.handle,
      range: { end: 10, start: 2 },
      type: 'agent',
    },
  ]);
});
