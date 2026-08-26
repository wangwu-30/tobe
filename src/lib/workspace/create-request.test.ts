import { expect, test } from '@playwright/test';

import {
  buildCreatedWorkspaceLocation,
  classifyWorkspaceCreateError,
  hasUnknownWorkspaceCreateOutcome,
  WorkspaceCreateActionError,
  WorkspaceCreateRequestError,
} from './create-request';
import {
  buildWorkspaceRoute,
  isCanonicalWorkspaceAssistantParam,
  parseWorkspaceAssistantTab,
} from './route';

test('workspace assistant routes use Chat as the implicit canonical default', () => {
  expect(parseWorkspaceAssistantTab(null)).toBe('chat');
  expect(parseWorkspaceAssistantTab('unknown')).toBe('chat');
  expect(
    buildWorkspaceRoute({ assistant: 'chat', projectId: 'wiki-1' })
  ).toBe('/workspace/wiki-1');
  expect(
    buildWorkspaceRoute({ assistant: 'room', projectId: 'wiki-1' })
  ).toBe('/workspace/wiki-1?assistant=room');

  expect(isCanonicalWorkspaceAssistantParam([])).toBe(true);
  expect(isCanonicalWorkspaceAssistantParam(['room'])).toBe(true);
  expect(isCanonicalWorkspaceAssistantParam(['chat'])).toBe(false);
  expect(isCanonicalWorkspaceAssistantParam(['unknown'])).toBe(false);
  expect(isCanonicalWorkspaceAssistantParam(['room', 'status'])).toBe(false);
});

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

test('created workspace locations keep the chat tab implicit by default', () => {
  const location = buildCreatedWorkspaceLocation({
    conversationId: 'conversation-1',
    workspaceId: 'workspace-1',
  });

  const url = new URL(location, 'http://local.test');
  expect(url.pathname).toBe('/workspace/workspace-1');
  expect(url.searchParams.has('assistant')).toBe(false);
});

test('created workspace locations keep the room tab explicit', () => {
  const location = buildCreatedWorkspaceLocation({
    assistant: 'room',
    conversationId: 'conversation-1',
    workspaceId: 'workspace-1',
  });

  const url = new URL(location, 'http://local.test');
  expect(url.searchParams.get('assistant')).toBe('room');
});

test('workspace create errors distinguish stable rejection from unknown outcome', () => {
  expect(
    classifyWorkspaceCreateError({
      code: 'ONBOARDING_CONVERSATION_NOT_ADOPTABLE',
      kind: 'http',
      message: 'Conversation is no longer adoptable.',
      responsePresent: true,
      status: 409,
    })
  ).toBe('rejected');
  expect(
    classifyWorkspaceCreateError({
      kind: 'http',
      message: 'Temporary server error.',
      responsePresent: true,
      status: 503,
    })
  ).toBe('unknown');
  expect(
    classifyWorkspaceCreateError({
      kind: 'network',
      responsePresent: false,
      status: null,
    })
  ).toBe('unknown');
  expect(
    classifyWorkspaceCreateError({
      kind: 'parse',
      responsePresent: true,
      status: 200,
    })
  ).toBe('unknown');
  expect(
    classifyWorkspaceCreateError({
      code: 'WORKSPACE_CREATE_IN_PROGRESS',
      kind: 'http',
      message: 'Localized message independent from the contract code.',
      responsePresent: true,
      status: 409,
    })
  ).toBe('unknown');
  expect(
    classifyWorkspaceCreateError({
      kind: 'http',
      responsePresent: true,
      status: 408,
    })
  ).toBe('unknown');
  expect(
    hasUnknownWorkspaceCreateOutcome(
      new WorkspaceCreateRequestError('Conflict', 'rejected')
    )
  ).toBe(false);
  expect(
    hasUnknownWorkspaceCreateOutcome(
      new WorkspaceCreateRequestError('Temporary failure', 'unknown')
    )
  ).toBe(true);
  expect(
    hasUnknownWorkspaceCreateOutcome(
      new WorkspaceCreateActionError('Malformed success response')
    )
  ).toBe(true);
  expect(hasUnknownWorkspaceCreateOutcome(new Error('Connection reset'))).toBe(
    true
  );
});
