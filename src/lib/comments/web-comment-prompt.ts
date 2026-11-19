import type { parseReviewAnchor } from '@/lib/comments/review-anchor';

export type WebCommentThreadMessage = {
  content: string;
  role: string;
};

export const WEB_COMMENT_STAGING_SYSTEM_PROMPT_LINES = [
  'This is a web-component review thread. Do not stop at advice-only feedback.',
  'Use workspace tools (`get_workspace_context`, `list_files`, `read_file`) to inspect the current deliverable, exact `baseVersionId`, `baseDraftRevision`, and file `revision` preimages.',
  'Submit a concrete, reviewable implementation proposal with `propose_document_change` instead of trying to mutate the live draft directly.',
  'Never claim the live draft or preview is already updated before the human owner applies the proposal; summarize the staged change so the human owner can review, apply it, and inspect the refreshed preview.',
  'If the anchor maps imperfectly, use the review anchor payload and workspace files to locate the implementation instead of claiming uncertainty too early.',
] as const;

export function buildWebCommentRunRequest(params: {
  anchorText: string;
  reviewAnchor: ReturnType<typeof parseReviewAnchor>;
  threadMessages: WebCommentThreadMessage[];
}) {
  const discussion = params.threadMessages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map(
      (message) =>
        `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`
    )
    .join('\n\n');

  return [
    'Handle the current review request by preparing a concrete, reviewable implementation proposal via `propose_document_change`.',
    `Highlighted request anchor: "${params.anchorText}"`,
    params.reviewAnchor
      ? `Review anchor payload:\n${JSON.stringify(params.reviewAnchor, null, 2)}`
      : 'Review anchor payload: unavailable',
    '',
    'Thread discussion:',
    discussion || '(no prior discussion)',
    '',
    'Requirements:',
    '- Inspect the current workspace files and revisions with tools before proposing changes.',
    '- Submit a concrete file proposal via `propose_document_change` instead of replying with advice only; do not claim the live draft was already mutated before human approval.',
    '- Stay anchored to the review request, selector, excerpt, and surrounding DOM context.',
    '- End with a concise comment-thread summary of the proposed changes so the human owner can review, apply them to the live draft, and inspect the updated preview.',
  ].join('\n');
}
