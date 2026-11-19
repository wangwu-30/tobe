import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { apiRequest, primeClientState } from './helpers';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

type WorkspaceCreateResponse = {
  conversation: { id: string };
  room: { id: string };
  workspace: { id: string };
};

test.describe('Advanced pages bilingual i18n & accessibility (#21)', () => {
  test('renders /agents and /jobs in zh-CN with zero automated WCAG violations', async ({
    page,
  }) => {
    await primeClientState(page, { language: 'zh-CN' });

    await page.goto('/agents');
    await expect(page.getByRole('heading', { name: 'Agent 目录' })).toBeVisible();
    await expect(page.getByLabel('搜索 Agent')).toBeVisible();
    await expect(page.getByTestId('create-agent-button')).toContainText('新建 Agent');
    await expect(page.getByTestId('agent-filter-all')).toHaveText('全部');
    await expect(page.getByTestId('agent-filter-enabled')).toHaveText('已启用');
    await expect(page.getByTestId('agent-filter-disabled')).toHaveText('已停用');

    await page.getByTestId('create-agent-button').click();
    const editorDialog = page.getByTestId('agent-editor-dialog');
    await expect(editorDialog).toBeVisible();
    await expect(editorDialog.getByRole('heading', { name: '创建 Agent' })).toBeVisible();
    await expect(editorDialog.getByLabel('名称')).toBeVisible();
    await expect(editorDialog.getByRole('button', { name: '取消' })).toBeVisible();
    await editorDialog.getByRole('button', { name: '取消' }).click();
    await expect(editorDialog).toHaveCount(0);
    await expectNoAccessibilityViolations(page, '/agents zh-CN');

    await page.goto('/jobs');
    await expect(page.getByRole('heading', { name: '执行任务' })).toBeVisible();
    await expect(page.getByLabel('搜索执行任务')).toBeVisible();
    await expect(page.getByRole('button', { name: '刷新' })).toBeVisible();
    await expectNoAccessibilityViolations(page, '/jobs zh-CN');
  });

  test('renders Project Room in both zh-CN and en-US without hardcoded language leaks', async ({
    page,
  }, testInfo) => {
    const baseURL = String(testInfo.project.use.baseURL);
    const created = await apiRequest<WorkspaceCreateResponse>(baseURL, '/api/workspaces', {
      body: {
        deliverableType: 'document',
        goal: 'Verify Project Room bilingual rendering.',
        title: `Room i18n ${Date.now()}`,
      },
      method: 'POST',
    });
    const roomUrl = `/workspace/${created.workspace.id}?conversationId=${created.conversation.id}&assistant=room`;

    await primeClientState(page, { language: 'en-US' });
    await page.goto(roomUrl);
    await expect(page.getByTestId('project-room-surface')).toBeVisible();
    await expect(page.getByLabel('Room message', { exact: true })).toBeEnabled({ timeout: 15_000 });
    const roomSurface = page.getByTestId('project-room-surface');
    await expect(roomSurface.getByRole('heading', { name: 'Project Room' })).toBeVisible();
    await expect(roomSurface.getByText('Coordinated by AI Assistant')).toBeVisible();
    await expect(roomSurface.getByText('Live sync')).toBeVisible();
    await expect(roomSurface.getByRole('button', { name: 'Reply to You' })).toBeVisible();
    await expect(roomSurface.getByRole('button', { name: 'Select Agent' })).toBeVisible();
    await expect(roomSurface.getByLabel('Manage agent delegation grants')).toBeVisible();
    await expect(roomSurface.getByLabel('Refresh Room')).toBeVisible();
    await expectNoAccessibilityViolations(page, 'Project Room en-US');

    await page.evaluate(() => {
      window.localStorage.setItem('ai-settings', JSON.stringify({ language: 'zh-CN' }));
      window.dispatchEvent(new CustomEvent('dao:ai-settings-changed'));
    });

    await expect(roomSurface.getByText('AI Assistant 协调')).toBeVisible();
    await expect(roomSurface.getByText('实时同步')).toBeVisible();
    await expect(roomSurface.getByRole('button', { name: '回复 你' })).toBeVisible();
    await expect(roomSurface.getByRole('button', { name: '选择 Agent' })).toBeVisible();
    await expect(roomSurface.getByLabel('Room 消息', { exact: true })).toBeVisible();
    await expect(roomSurface.getByLabel('管理 Agent 委托授权')).toBeVisible();
    await expect(roomSurface.getByLabel('刷新 Room')).toBeVisible();
    await expectNoAccessibilityViolations(page, 'Project Room zh-CN');
  });
});

async function expectNoAccessibilityViolations(page: Page, surface: string) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    result.violations,
    `${surface} accessibility violations:\n${result.violations
      .map((violation) => `${violation.id}: ${violation.help}`)
      .join('\n')}`
  ).toEqual([]);
}
