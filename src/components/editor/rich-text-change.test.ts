import { expect, test } from '@playwright/test';
import type { Value } from 'platejs';

import {
  serializeChangedRichTextValue,
  serializeRichTextForComparison,
} from './rich-text-change';

const INITIAL_VALUE: Value = [
  {
    children: [
      {
        children: [{ text: 'Nested title' }],
        type: 'span',
      },
    ],
    type: 'h1',
  },
  {
    children: [{ bold: true, text: 'Body copy' }],
    type: 'p',
  },
];

test('Plate node ids alone do not produce a rich-text change', () => {
  const normalizedValue = [
    {
      children: [
        {
          children: [{ text: 'Nested title' }],
          id: 'inline-node-id',
          type: 'span',
        },
      ],
      id: 'heading-node-id',
      type: 'h1',
    },
    {
      children: [{ bold: true, text: 'Body copy' }],
      id: 'paragraph-node-id',
      type: 'p',
    },
  ] as Value;

  expect(
    serializeChangedRichTextValue(
      normalizedValue,
      serializeRichTextForComparison(INITIAL_VALUE)
    )
  ).toBeNull();
});

test('semantic edits save the complete normalized rich-text value', () => {
  const editedValue = [
    {
      children: [
        {
          children: [{ text: 'Updated title' }],
          id: 'inline-node-id',
          type: 'span',
        },
      ],
      id: 'heading-node-id',
      type: 'h1',
    },
    {
      children: [{ bold: true, text: 'Body copy' }],
      id: 'paragraph-node-id',
      type: 'p',
    },
  ] as Value;

  const serialized = serializeChangedRichTextValue(
    editedValue,
    serializeRichTextForComparison(INITIAL_VALUE)
  );

  expect(serialized).toBe(JSON.stringify(editedValue));
  expect(serialized).toContain('heading-node-id');
  expect(serialized).toContain('inline-node-id');
  expect(serialized).toContain('paragraph-node-id');
});

test('ids in nested metadata remain part of the semantic comparison', () => {
  const initialValue = [
    {
      children: [{ text: 'Body copy' }],
      metadata: { id: 'source-record-a', text: 'Imported source' },
      type: 'p',
    },
  ] as Value;
  const editedValue = [
    {
      children: [{ id: 'text-node-id', text: 'Body copy' }],
      id: 'paragraph-node-id',
      metadata: { id: 'source-record-b', text: 'Imported source' },
      type: 'p',
    },
  ] as Value;

  expect(
    serializeChangedRichTextValue(
      editedValue,
      serializeRichTextForComparison(initialValue)
    )
  ).toBe(JSON.stringify(editedValue));
});
