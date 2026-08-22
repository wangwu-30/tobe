import { expect, test } from '@playwright/test';

import {
  applyRoomTextEdit,
  findRoomMentionQuery,
  getValidRoomMentions,
  insertRoomMention,
  removeRoomMention,
  type RoomComposerDraft,
} from './mentions';

const analyst = { handle: '@analyst', id: 'agent-analyst' };
const writer = { handle: '@writer', id: 'agent-writer' };

test('creates distinct structured UTF-16 ranges for multiple selected agents', () => {
  const first = insertRoomMention(
    { mentions: [], text: '😀 Ask ' },
    analyst,
    { end: 7, start: 7 }
  );
  const second = insertRoomMention(
    first.draft,
    writer,
    { end: first.caret, start: first.caret }
  );

  expect(second.draft.text).toBe('😀 Ask @analyst @writer ');
  expect(getValidRoomMentions(second.draft)).toEqual([
    {
      agentId: 'agent-analyst',
      handle: '@analyst',
      range: { end: 15, start: 7 },
      type: 'agent',
    },
    {
      agentId: 'agent-writer',
      handle: '@writer',
      range: { end: 23, start: 16 },
      type: 'agent',
    },
  ]);
});

test('shifts untouched mentions and invalidates a mention edited as plain text', () => {
  const draft: RoomComposerDraft = {
    mentions: [
      {
        agentId: analyst.id,
        handle: analyst.handle,
        range: { end: 8, start: 0 },
        type: 'agent',
      },
    ],
    text: '@analyst review this',
  };

  const prefixed = applyRoomTextEdit(draft, 'Please @analyst review this');
  expect(prefixed.mentions[0]?.range).toEqual({ end: 15, start: 7 });

  const editedToken = applyRoomTextEdit(prefixed, 'Please @analysis review this');
  expect(editedToken.mentions).toEqual([]);
  expect(getValidRoomMentions({ mentions: [], text: '@analyst raw text' })).toEqual(
    []
  );
});

test('removing one selected agent updates the remaining mention range', () => {
  const first = insertRoomMention(
    { mentions: [], text: '' },
    analyst,
    { end: 0, start: 0 }
  );
  const second = insertRoomMention(
    first.draft,
    writer,
    { end: first.caret, start: first.caret }
  );
  const removed = removeRoomMention(second.draft, analyst.id);

  expect(removed.draft.text).toBe('@writer ');
  expect(removed.draft.mentions).toEqual([
    {
      agentId: writer.id,
      handle: writer.handle,
      range: { end: 7, start: 0 },
      type: 'agent',
    },
  ]);
});

test('finds only the active @ query at the caret', () => {
  expect(findRoomMentionQuery('hello @ana', 10)).toEqual({
    end: 10,
    query: 'ana',
    start: 6,
  });
  expect(findRoomMentionQuery('email@example.com', 17)).toBeNull();
  expect(findRoomMentionQuery('hello @ana done', 15)).toBeNull();
});

test('separates a toolbar-inserted mention from adjacent prose', () => {
  const inserted = insertRoomMention(
    { mentions: [], text: 'Ask' },
    analyst,
    { end: 3, start: 3 }
  );

  expect(inserted.draft.text).toBe('Ask @analyst ');
  expect(inserted.draft.mentions[0]?.range).toEqual({ end: 12, start: 4 });
});
