import type { ReviewAnchorData } from '@/types';

export function parseReviewAnchor(selectionAnchor: string | null): ReviewAnchorData | null {
  if (!selectionAnchor) {
    return null;
  }

  try {
    const parsed = JSON.parse(selectionAnchor);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.surfaceType === 'string' &&
      typeof parsed.bindingType === 'string' &&
      parsed.anchorPayload &&
      typeof parsed.anchorPayload === 'object'
    ) {
      return parsed as ReviewAnchorData;
    }
  } catch {
    return null;
  }

  return null;
}

export function buildReviewAnchorFingerprint(params: {
  anchorText: string;
  fileId: string | null;
  reviewAnchor: ReviewAnchorData | null;
  selectionAnchor: string | null;
}) {
  const reviewAnchor = params.reviewAnchor || parseReviewAnchor(params.selectionAnchor);
  const surfaceKey =
    typeof reviewAnchor?.surfaceType === 'string' ? reviewAnchor.surfaceType : 'default';
  const selector =
    readReviewAnchorString(reviewAnchor, ['cssSelector']) ||
    readReviewAnchorString(reviewAnchor, ['selector']);
  const excerpt =
    readReviewAnchorString(reviewAnchor, ['excerpt']) || params.anchorText || '';
  const fingerprintValue = selector || excerpt;
  return `${params.fileId || 'workspace'}::${surfaceKey}::${normalizeReviewAnchorText(fingerprintValue)}`;
}

export function extractReviewAnchorSearchCandidates(params: {
  anchorText: string;
  reviewAnchor: ReviewAnchorData | null | undefined;
}) {
  const candidates = new Set<string>();
  const reviewAnchor = params.reviewAnchor || null;

  [
    params.anchorText,
    readReviewAnchorString(reviewAnchor, ['excerpt']),
    readReviewAnchorString(reviewAnchor, ['domContext']),
  ].forEach((value) => {
    const normalized = normalizeReviewAnchorText(value || '');
    if (normalized) {
      candidates.add(normalized);
    }
  });

  const selector =
    readReviewAnchorString(reviewAnchor, ['cssSelector']) ||
    readReviewAnchorString(reviewAnchor, ['selector']);
  extractCssSelectorSearchTokens(selector).forEach((token) => {
    const normalized = normalizeReviewAnchorText(token);
    if (normalized) {
      candidates.add(normalized);
    }
  });

  return [...candidates];
}

export function extractReviewAnchorIdentityCandidates(params: {
  anchorText: string;
  reviewAnchor: ReviewAnchorData | null | undefined;
}) {
  const candidates = new Set<string>();
  const reviewAnchor = params.reviewAnchor || null;

  addIdentityCandidate(
    candidates,
    readReviewAnchorString(reviewAnchor, ['cssSelector']) ||
      readReviewAnchorString(reviewAnchor, ['selector']),
    1
  );
  addIdentityCandidate(
    candidates,
    readReviewAnchorString(reviewAnchor, ['excerpt']) || params.anchorText,
    12
  );
  addIdentityCandidate(candidates, readReviewAnchorString(reviewAnchor, ['domContext']), 24);

  return [...candidates];
}

function readReviewAnchorString(
  reviewAnchor: ReviewAnchorData | null | undefined,
  keys: string[]
) {
  for (const key of keys) {
    const value = reviewAnchor?.anchorPayload?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function extractCssSelectorSearchTokens(selector: string | null) {
  if (!selector) {
    return [];
  }

  const tokens = selector.match(/[A-Za-z][A-Za-z0-9_-]*/g) || [];
  return tokens.filter((token) => token !== 'nth' && token !== 'of' && token !== 'type');
}

function normalizeReviewAnchorText(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function addIdentityCandidate(
  target: Set<string>,
  value: string | null,
  minLength: number
) {
  const normalized = normalizeReviewAnchorText(value || '');
  if (normalized.length >= minLength) {
    target.add(normalized);
  }
}
