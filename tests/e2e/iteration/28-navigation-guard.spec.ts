import { expect, test } from '@playwright/test';
import { primeClientState } from './helpers';

test('Knowledge dirty guard covers shell link navigation and restores back and forward', async ({
  page,
}) => {
  await primeClientState(page);

  await page.goto('/settings');
  await page.getByRole('link', { name: 'Knowledge', exact: true }).click();
  const configurationTab = page.getByTestId('knowledge-configuration-tab');
  await configurationTab.click();
  await expect(configurationTab).toHaveAttribute('aria-current', 'page');
  const repoPath = page.getByTestId('knowledge-repo-path');
  await repoPath.fill('/tmp/unsaved-navigation-guard');

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: /团队任务|Team Tasks/ }).click();
  await expect(page).toHaveURL(/\/knowledge\?view=configuration$/);
  await expect(repoPath).toHaveValue('/tmp/unsaved-navigation-guard');

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.goBack({ waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/knowledge\?view=configuration$/);
  await expect(repoPath).toHaveValue('/tmp/unsaved-navigation-guard');

  page.once('dialog', (dialog) => dialog.accept());
  await page.goBack();
  await expect(page).toHaveURL(/\/knowledge\?view=reviews/);

  await page.goForward();
  await expect(page).toHaveURL(/\/knowledge\?view=configuration$/);
  await expect(repoPath).toHaveValue('');
  await page.getByRole('link', { name: /团队任务|Team Tasks/ }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/knowledge\?view=configuration$/);
  const restoredRepoPath = page.getByTestId('knowledge-repo-path');
  await expect(restoredRepoPath).toHaveValue('');
  await restoredRepoPath.fill('/tmp/unsaved-forward-guard-again');

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.goForward({ waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/knowledge\?view=configuration$/);
  await expect(restoredRepoPath).toHaveValue('/tmp/unsaved-forward-guard-again');
});
