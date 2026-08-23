import type { Value } from 'platejs';

const EMPTY_RICH_TEXT_VALUE: Value = [
  { type: 'p', children: [{ text: '' }] },
];

function canonicalizeRichTextValue(
  value: unknown,
  isRichTextNode = false
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeRichTextValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'id' || !isRichTextNode)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [
        key,
        isRichTextNode && key === 'children' && Array.isArray(child)
          ? child.map((node) => canonicalizeRichTextValue(node, true))
          : canonicalizeRichTextValue(child),
      ])
  );
}

export function serializeRichTextForComparison(
  value: Value | null | undefined
) {
  return JSON.stringify(
    (value || EMPTY_RICH_TEXT_VALUE).map((node) =>
      canonicalizeRichTextValue(node, true)
    )
  );
}

export function serializeChangedRichTextValue(
  value: Value | null | undefined,
  lastLoadedSemanticValue: string
) {
  if (serializeRichTextForComparison(value) === lastLoadedSemanticValue) {
    return null;
  }

  return JSON.stringify(value || EMPTY_RICH_TEXT_VALUE);
}
