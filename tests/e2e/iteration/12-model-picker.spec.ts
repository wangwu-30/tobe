import { expect, test } from '@playwright/test';
import { buildWorkspaceRoute } from '@/lib/workspace/route';
import { primeClientState, readSeedState } from './helpers';

test('Global settings ModelPicker shows correct options and cascade changes', async ({
  page,
}) => {
  await primeClientState(page);
  await page.goto('/settings');

  await expect(page.getByRole('heading', { name: /语言|Language/ })).toBeVisible();
  const defaultModelCard = page.getByTestId('settings-default-model-card');
  await expect(defaultModelCard).toBeVisible();
  const providerSelectTrigger = defaultModelCard.getByRole('combobox').first();

  await expect(providerSelectTrigger).toBeVisible();
  await expect(providerSelectTrigger).not.toBeDisabled();
  await providerSelectTrigger.click();
  const pList = page.getByRole('listbox');
  const providerOptions = pList.getByRole('option');
  expect(await providerOptions.count()).toBeGreaterThan(0);

  const anthropicOption = providerOptions.filter({ hasText: /Anthropic/ });
  if (await anthropicOption.count()) {
    await anthropicOption.first().click();
    await expect(defaultModelCard).toContainText(/Claude/);

    await providerSelectTrigger.click();
    const openAiOption = page.getByRole('listbox').getByRole('option', { name: /OpenAI/ });
    await openAiOption.first().click();
    await expect(defaultModelCard).toContainText(/OpenAI/);
    await expect(defaultModelCard).toContainText(/Codex|GPT/);
  } else {
    await page.keyboard.press('Escape');
    await expect(defaultModelCard).toContainText(/OpenAI Codex/);
    await expect(defaultModelCard).toContainText(/GPT-5\.2 Codex|GPT/);
  }
});

test('workspace composer opens model selection in a conversation settings sheet and sends with the temporary selection', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.baseWorkspace;
  const selectedModelKey = 'test-provider::test-model-b';

  await page.setViewportSize({ height: 900, width: 768 });
  await primeClientState(page);
  await page.route('**/api/ai/models', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        defaultModelKey: 'test-provider::test-model-a',
        providers: [
          {
            authState: 'api_key_configured',
            configured: true,
            disabledReason: null,
            id: 'test-provider',
            label: 'Test Provider',
            models: [
              {
                id: 'test-model-a',
                key: 'test-provider::test-model-a',
                name: 'Test Model A',
                providerId: 'test-provider',
              },
              {
                id: 'test-model-b',
                key: selectedModelKey,
                name: 'Test Model B',
                providerId: 'test-provider',
              },
            ],
          },
        ],
      }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.goto(buildWorkspaceRoute({
    assistant: 'chat',
    conversationId: workspace.conversationId,
    nodeId: workspace.id,
    projectId: workspace.id,
  }));
  await expect(page.getByTestId('assistant-tab-chat')).toHaveAttribute('data-state', 'active');

  const composer = page.getByTestId('chat-composer');
  await expect(composer).toBeVisible();

  await expect(composer.getByRole('combobox')).toHaveCount(0);
  const settingsTrigger = composer.getByTestId('chat-model-settings-trigger');
  await expect(settingsTrigger).toBeVisible();
  await expect(settingsTrigger).toHaveAccessibleName(/对话设置|Conversation settings/);
  const settingsTriggerBox = await settingsTrigger.boundingBox();
  expect(settingsTriggerBox?.height).toBeGreaterThanOrEqual(44);
  await settingsTrigger.click();

  const settingsSheet = page.getByTestId('chat-model-settings-sheet');
  await expect(settingsSheet).toBeVisible();
  await expect(
    settingsSheet.getByRole('heading', { name: /对话设置|Conversation settings/ })
  ).toBeVisible();
  await expect(settingsSheet).toContainText(
    /选择这段对话使用的模型|Choose the model used for this conversation/
  );
  await expect(settingsSheet.getByRole('combobox')).toHaveCount(2);
  await expect(settingsSheet).toHaveCSS('transform', 'none');
  const providerCombobox = settingsSheet.getByRole('combobox', {
    name: 'Provider',
    exact: true,
  });
  const modelCombobox = settingsSheet.getByRole('combobox', { name: /模型|Model/ });

  await expect(providerCombobox).toBeVisible();
  await expect(modelCombobox).toBeVisible();
  for (const target of [
    providerCombobox,
    modelCombobox,
    settingsSheet.getByRole('button', { name: /关闭|Close/ }),
  ]) {
    const box = await target.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  await expect(providerCombobox).toHaveAccessibleName(/Provider/);
  await expect(modelCombobox).toHaveAccessibleName(/模型|Model/);
  await expect(providerCombobox).toHaveAttribute('aria-autocomplete', 'none');
  await expect(modelCombobox).toHaveAttribute('aria-autocomplete', 'none');
  await modelCombobox.click();
  await page.getByRole('option', { name: 'Test Model B', exact: true }).click();
  await expect(modelCombobox).toContainText('Test Model B');
  await settingsSheet.getByRole('button', { name: /关闭|Close/ }).click();
  await expect(settingsSheet).toBeHidden();
  await expect(composer.getByRole('combobox')).toHaveCount(0);
  await expect(settingsTrigger).toContainText('Test Model B');

  const researchButton = page.getByRole('button', { name: /深度研究|Deep Research/ });
  await expect(researchButton).toBeVisible();
  await expect(researchButton).toHaveAttribute('aria-pressed', 'false');
  await researchButton.click();
  await expect(researchButton).toHaveAttribute('aria-pressed', 'true');
  await researchButton.click();
  await expect(researchButton).toHaveAttribute('aria-pressed', 'false');

  const messageInput = composer.getByRole('textbox', {
    name: /给 Agent 发消息|Message Agent/,
  });
  await expect(messageInput).toHaveAttribute('name', 'message');
  await expect(messageInput).toHaveAttribute('autocomplete', 'off');
  await expect(
    composer.getByRole('button', { name: /添加附件|Add attachments/ })
  ).toBeVisible();
  await expect(
    composer.getByRole('button', { name: /发送消息|Send message/ })
  ).toBeVisible();

  const pasteWasPrevented = await messageInput.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'Keep pasted text');
    clipboard.items.add(new File(['attachment'], 'pasted-note.txt', { type: 'text/plain' }));
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(pasteWasPrevented).toBe(false);
  await expect(composer.getByText('pasted-note.txt')).toBeVisible();
  const removeMixedAttachment = composer.getByRole('button', {
    name: /移除 pasted-note.txt|Remove pasted-note.txt/,
  });
  await expect(removeMixedAttachment).toBeVisible();
  await removeMixedAttachment.click();

  await page.route('**/api/agent/run', async (route) => {
    await route.fulfill({
      body: 'Oversized paste received.',
      contentType: 'text/plain; charset=utf-8',
      status: 200,
    });
  });

  await messageInput.fill('Existing draft');
  const oversizedPasteWasPrevented = await messageInput.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    const pastedText = `OVERSIZED_CLIPBOARD_${'x'.repeat(4100)}_END`;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', pastedText);
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    });
    textarea.dispatchEvent(pasteEvent);

    if (!pasteEvent.defaultPrevented) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.setRangeText(pastedText, start, end, 'end');
      textarea.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: pastedText,
          inputType: 'insertFromPaste',
        })
      );
    }

    return pasteEvent.defaultPrevented;
  });

  expect(oversizedPasteWasPrevented).toBe(false);
  await expect(messageInput).toHaveValue('Existing draft');
  await expect(composer.getByText(/clipboard-.*.txt/)).toBeVisible();

  const runRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/agent/run'
  );
  await composer.getByRole('button', { name: /发送消息|Send message/ }).click();
  const runRequest = await runRequestPromise;
  const contentType = runRequest.headers()['content-type'];
  const requestBody = runRequest.postDataBuffer();

  expect(contentType).toContain('multipart/form-data; boundary=');
  expect(requestBody).not.toBeNull();
  const submittedForm = await new Response(Uint8Array.from(requestBody!), {
    headers: { 'content-type': contentType },
  }).formData();
  const submittedBody = requestBody?.toString('utf8') || '';

  await expect(page.getByText('Oversized paste received.', { exact: true })).toBeVisible();
  expect((submittedBody.match(/OVERSIZED_CLIPBOARD_/g) || [])).toHaveLength(1);
  expect(submittedBody).toContain('Existing draft');
  expect(submittedForm.get('model')).toBe(selectedModelKey);
});

test('workspace chat composer re-syncs to the saved default model when re-entering an existing workspace', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.baseWorkspace;

  await primeClientState(page);
  await page.goto('/settings');

  const defaultModelCard = page.getByTestId('settings-default-model-card');
  const settingsProviderCombobox = defaultModelCard.getByRole('combobox').first();
  const settingsModelCombobox = defaultModelCard.getByRole('combobox').nth(1);

  const initialProvider = (await settingsProviderCombobox.textContent())?.trim() || '';
  const initialModel = (await settingsModelCombobox.textContent())?.trim() || '';
  let expectedProvider = initialProvider;
  let expectedModel = initialModel;

  await settingsProviderCombobox.click();
  const providerOptions = page.getByRole('listbox').getByRole('option');
  const providerCount = await providerOptions.count();
  let switchedSelection = false;

  for (let index = 0; index < providerCount; index += 1) {
    const option = providerOptions.nth(index);
    const text = (await option.textContent())?.trim() || '';
    if (text && text !== initialProvider) {
      await option.click();
      expectedProvider = text.replace(/\s+(OAuth|API)\s*$/u, '').trim();
      switchedSelection = true;
      break;
    }
  }

  if (!switchedSelection) {
    await page.keyboard.press('Escape');
    await settingsModelCombobox.click();
    const modelOptions = page.getByRole('listbox').getByRole('option');
    const modelCount = await modelOptions.count();

    for (let index = 0; index < modelCount; index += 1) {
      const option = modelOptions.nth(index);
      const text = (await option.textContent())?.trim() || '';
      if (text && text !== initialModel) {
        await option.click();
        expectedModel = text;
        switchedSelection = true;
        break;
      }
    }
  }

  await expect(settingsModelCombobox).toContainText(/\S+/);
  expectedModel = (await settingsModelCombobox.textContent())?.trim() || expectedModel;

  if (!switchedSelection) {
    return;
  }

  await page.getByRole('button', { name: /保存|Save/ }).click();
  await expect(page.getByText(/已保存|Saved/)).toBeVisible();

  await page.goto(buildWorkspaceRoute({
    assistant: 'chat',
    conversationId: workspace.conversationId,
    nodeId: workspace.id,
    projectId: workspace.id,
  }));
  const chatTab = page.getByTestId('assistant-tab-chat');
  await expect(chatTab).toHaveAttribute('data-state', 'active');

  const composer = page.getByTestId('chat-composer');
  await expect(composer).toBeVisible();
  await expect(composer.getByRole('combobox')).toHaveCount(0);
  await composer.getByTestId('chat-model-settings-trigger').click();
  const settingsSheet = page.getByTestId('chat-model-settings-sheet');
  await expect(settingsSheet).toBeVisible();
  const workspaceProviderCombobox = settingsSheet.getByRole('combobox', {
    name: 'Provider',
    exact: true,
  });
  const workspaceModelCombobox = settingsSheet.getByRole('combobox', {
    name: /模型|Model/,
  });

  await expect(workspaceProviderCombobox).toContainText(expectedProvider);
  await expect(workspaceModelCombobox).toContainText(expectedModel);
});
