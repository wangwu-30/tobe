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
