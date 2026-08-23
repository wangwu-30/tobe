import { expect, test } from '@playwright/test';

import { buildCreatedWorkspaceLocation } from './create-request';

test('created workspace locations preserve the active assistant tab', () => {
  const location = buildCreatedWorkspaceLocation({
    assistant: 'status',
    conversationId: 'conversation-1',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
  });

  const url = new URL(location, 'http://local.test');
  expect(url.pathname).toBe('/workspace/project-1');
  expect(url.searchParams.get('assistant')).toBe('status');
  expect(url.searchParams.get('conversationId')).toBe('conversation-1');
  expect(url.searchParams.get('node')).toBe('workspace-1');
});

test('created workspace locations keep the room tab implicit by default', () => {
  const location = buildCreatedWorkspaceLocation({
    conversationId: 'conversation-1',
    workspaceId: 'workspace-1',
  });

  const url = new URL(location, 'http://local.test');
  expect(url.pathname).toBe('/workspace/workspace-1');
  expect(url.searchParams.has('assistant')).toBe(false);
});
