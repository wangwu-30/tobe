import { createHash } from 'node:crypto';
import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@libsql/client';
import { getSuggestionKey } from '@platejs/suggestion';
import { expect, test } from '@playwright/test';

import { apiRequest, buildHeading, primeClientState } from './helpers';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function resolveIterationDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }
  const iterationRoot =
    process.env.ITERATION_ROOT ||
    path.join(process.cwd(), '.tmp', 'iteration-regression');
  const appDataRoot =
    process.env.DAO_APP_DATA_ROOT || path.join(iterationRoot, 'app-data');
  return `file:${path.join(appDataRoot, 'dev.db')}`;
}

test('inline suggestion Accept/Reject controls are keyboard accessible without mouse hover and Version Tree clarifies the three layers', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const created = await apiRequest<{
    conversation: { id: string };
    primaryFile: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal: `Verify keyboard inline suggestions and version layers ${suffix}`,
      title: `Review Flow Wiki ${suffix}`,
    },
    method: 'POST',
  });

  const suggestionId = `sugg-kb-${suffix}`;
  const suggestedText = 'keyboard-accepted suggestion clause';
  const baseText = 'Opening sentence before ';

  await apiRequest(
    baseURL,
    `/api/workspaces/${created.workspace.id}/files/${created.primaryFile.id}`,
    {
      body: {
        content: JSON.stringify([
          buildHeading('Review Flow Verification'),
          {
            type: 'p',
            children: [
              { text: baseText },
              {
                text: suggestedText,
                suggestion: true,
                [getSuggestionKey(suggestionId)]: {
                  createdAt: Date.now(),
                  id: suggestionId,
                  type: 'insert',
                  userId: 'alice',
                },
              },
            ],
          },
        ]),
      },
      method: 'PATCH',
    }
  );

  await primeClientState(page);
  await page.goto(
    `/workspace/${created.workspace.id}?node=${created.workspace.id}&conversationId=${created.conversation.id}`
  );

  const suggestionTrigger = page.getByTestId('block-suggestion-trigger');
  await expect(suggestionTrigger).toBeVisible();
  await suggestionTrigger.focus();
  await page.keyboard.press('Enter');

  const acceptButton = page.getByTestId(`suggestion-accept-${suggestionId}`);
  const rejectButton = page.getByTestId(`suggestion-reject-${suggestionId}`);

  // Both Accept and Reject are rendered and accessible without hovering the card
  await expect(acceptButton).toBeVisible();
  await expect(rejectButton).toBeVisible();

  const popoverAxe = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
  expect(popoverAxe.violations).toEqual([]);

  // Accept purely via keyboard focus + Enter
  await acceptButton.focus();
  await expect(acceptButton).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('block-suggestion-trigger')).toHaveCount(0);
  await expect(
    page.locator('[data-workspace-outline-surface="true"]')
  ).toContainText(`${baseText}${suggestedText}`);

  // Version Tree presents the 3-layer mental model clearly
  await page.getByRole('button', { name: /版本树|Version Tree/ }).click();
  const layersSummary = page.getByTestId('version-layers-summary');
  await expect(layersSummary).toBeVisible();
  await expect(layersSummary).toContainText(/当前草稿|Current Draft/);
  await expect(layersSummary).toContainText(/里程碑|Milestone/);
  await expect(layersSummary).toContainText(/回退安全网|Recovery Safety Net/);

  const versionTreeAxe = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
  expect(versionTreeAxe.violations).toEqual([]);
});

test('discarding a staged change refreshes workspace state in-place without a page reload', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const proposalId = `e2e-discard-proposal-${suffix}`;
  const proposalTitle = `Discardable suggestion ${suffix}`;

  const created = await apiRequest<{
    conversation: { id: string };
    primaryFile: { content: string; id: string; kind: string; name: string; revision: number };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal: `Verify in-place discard without reload ${suffix}`,
      title: `Discard Flow ${suffix}`,
    },
    method: 'POST',
  });

  const view = await apiRequest<{
    files: Array<{
      content: string;
      id: string;
      kind: 'richtext' | 'markdown';
      name: string;
      revision: number;
    }>;
    workspace: { draftBaseVersionId: string | null; draftRevision: number };
  }>(
    baseURL,
    `/api/workspaces/${created.workspace.id}?conversationId=${created.conversation.id}`
  );
  const primaryFile = view.files.find((file) => file.id === created.primaryFile.id);
  if (!primaryFile) {
    throw new Error('Expected created workspace to have primary file');
  }

  const patches = [
    {
      fileId: primaryFile.id,
      kind: primaryFile.kind,
      name: primaryFile.name,
      nextContent: JSON.stringify([
        buildHeading('Proposed Change'),
        { type: 'p', children: [{ text: 'Suggested replacement text' }] },
      ]),
      operation: 'update',
      preimage: {
        content: primaryFile.content,
        contentSha256: sha256(primaryFile.content),
        revision: primaryFile.revision,
      },
      summary: 'Replace draft text for discard test.',
    },
  ];
  const changesJson = JSON.stringify(patches);
  const now = new Date().toISOString();
  const database = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    await database.execute('PRAGMA busy_timeout = 5000');
    await database.execute({
      sql: `INSERT INTO "StagedChangeSet" (
        "id", "organizationId", "documentId", "sessionId",
        "baseVersionId", "baseVersionSha256", "baseDraftRevision",
        "patchSchemaVersion", "patchSha256", "title", "summary",
        "status", "sourceType", "changesJson", "createdByUserId",
        "originDeviceId", "revision", "createdAt", "updatedAt"
      ) VALUES (?, 'local-org', ?, ?, ?, NULL, ?, 1, ?, ?, ?,
        'pending', 'acceptance-test', ?, 'local-user', 'local-device', 1, ?, ?)`,
      args: [
        proposalId,
        created.workspace.id,
        created.conversation.id,
        view.workspace.draftBaseVersionId,
        view.workspace.draftRevision,
        sha256(changesJson),
        proposalTitle,
        'Test discarding without full-page reload.',
        changesJson,
        now,
        now,
      ],
    });
  } finally {
    await database.close();
  }

  await primeClientState(page);
  await page.goto(
    `/workspace/${created.workspace.id}?node=${created.workspace.id}&conversationId=${created.conversation.id}`
  );

  const composer = page.getByTestId('agent-composer-input');
  const draftNote = 'Unsent chat input stays intact on discard.';
  await composer.fill(draftNote);

  let mainFrameNavigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      mainFrameNavigations += 1;
    }
  });

  await page.getByTestId('staged-review-trigger').click();
  const reviewPanel = page.getByTestId('staged-review-panel');
  await expect(reviewPanel).toBeVisible();
  await reviewPanel.getByTestId(`staged-change-discard-${proposalId}`).click();

  await expect(page.getByTestId('staged-change-notice')).toContainText(
    /已丢弃建议修改|Discarded Suggested changes/
  );
  await expect(reviewPanel).toBeHidden();
  await expect(page.getByTestId('staged-review-trigger')).toHaveCount(0);
  expect(mainFrameNavigations).toBe(0);
  await expect(composer).toHaveValue(draftNote);
});
