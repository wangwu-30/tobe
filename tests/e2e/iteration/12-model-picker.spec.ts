import { expect, test } from '@playwright/test';
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

test('ChatInput compact ModelPicker renders the current selection inside the workspace composer', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.baseWorkspace;

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /对话|Chat/ }).click();

  const composer = page.getByTestId('chat-composer');
  await expect(composer).toBeVisible();

  const comboboxes = composer.getByRole('combobox');
  await expect(comboboxes).toHaveCount(2);
  const providerCombobox = comboboxes.first();
  const modelCombobox = comboboxes.nth(1);

  await expect(providerCombobox).toBeVisible();
  await expect(modelCombobox).toBeVisible();
  await expect(page.getByRole('button', { name: /深度研究|Deep Research/ })).toBeVisible();

  await providerCombobox.click();
  const providerList = page.getByRole('listbox');
  expect(await providerList.getByRole('option').count()).toBeGreaterThan(0);
  await expect(providerList.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(modelCombobox).toContainText(/\S+/);
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

  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /对话|Chat/ }).click();

  const composer = page.getByTestId('chat-composer');
  const workspaceProviderCombobox = composer.getByRole('combobox').first();
  const workspaceModelCombobox = composer.getByRole('combobox').nth(1);

  await expect(workspaceProviderCombobox).toContainText(expectedProvider);
  await expect(workspaceModelCombobox).toContainText(expectedModel);
});
