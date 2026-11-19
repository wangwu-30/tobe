import assert from 'node:assert/strict';
import test from 'node:test';

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
  assert.equal(parseWorkspaceAssistantTab(null), 'chat');
  assert.equal(parseWorkspaceAssistantTab('unknown'), 'chat');
  assert.equal(
    buildWorkspaceRoute({ assistant: 'chat', projectId: 'wiki-1' }),
    '/workspace/wiki-1'
  );
  assert.equal(
    buildWorkspaceRoute({ assistant: 'room', projectId: 'wiki-1' }),
    '/workspace/wiki-1?assistant=room'
  );

  assert.equal(isCanonicalWorkspaceAssistantParam([]), true);
  assert.equal(isCanonicalWorkspaceAssistantParam(['room']), true);
  assert.equal(isCanonicalWorkspaceAssistantParam(['chat']), false);
  assert.equal(isCanonicalWorkspaceAssistantParam(['unknown']), false);
  assert.equal(isCanonicalWorkspaceAssistantParam(['room', 'status']), false);
});

test('created workspace locations preserve the active assistant tab', () => {
  const location = buildCreatedWorkspaceLocation({
    assistant: 'status',
    conversationId: 'conversation-1',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
  });

  const url = new URL(location, 'http://local.test');
  assert.equal(url.pathname, '/workspace/project-1');
  assert.equal(url.searchParams.get('assistant'), 'status');
  assert.equal(url.searchParams.get('conversationId'), 'conversation-1');
  assert.equal(url.searchParams.get('node'), 'workspace-1');
});

test('created workspace locations keep the chat tab implicit by default', () => {
  const location = buildCreatedWorkspaceLocation({
    conversationId: 'conversation-1',
    workspaceId: 'workspace-1',
  });

  const url = new URL(location, 'http://local.test');
  assert.equal(url.pathname, '/workspace/workspace-1');
  assert.equal(url.searchParams.has('assistant'), false);
});

test('created workspace locations keep the room tab explicit', () => {
  const location = buildCreatedWorkspaceLocation({
    assistant: 'room',
    conversationId: 'conversation-1',
    workspaceId: 'workspace-1',
  });

  const url = new URL(location, 'http://local.test');
  assert.equal(url.searchParams.get('assistant'), 'room');
});

test('workspace create errors distinguish stable rejection from unknown outcome', () => {
  assert.equal(
    classifyWorkspaceCreateError({
      code: 'ONBOARDING_CONVERSATION_NOT_ADOPTABLE',
      kind: 'http',
      message: 'Conversation is no longer adoptable.',
      responsePresent: true,
      status: 409,
    }),
    'rejected'
  );
  assert.equal(
    classifyWorkspaceCreateError({
      kind: 'http',
      message: 'Temporary server error.',
      responsePresent: true,
      status: 503,
    }),
    'unknown'
  );
  assert.equal(
    classifyWorkspaceCreateError({
      kind: 'network',
      responsePresent: false,
      status: null,
    }),
    'unknown'
  );
  assert.equal(
    classifyWorkspaceCreateError({
      kind: 'parse',
      responsePresent: true,
      status: 200,
    }),
    'unknown'
  );
  assert.equal(
    classifyWorkspaceCreateError({
      code: 'WORKSPACE_CREATE_IN_PROGRESS',
      kind: 'http',
      message: 'Localized message independent from the contract code.',
      responsePresent: true,
      status: 409,
    }),
    'unknown'
  );
  assert.equal(
    classifyWorkspaceCreateError({
      kind: 'http',
      responsePresent: true,
      status: 408,
    }),
    'unknown'
  );
  assert.equal(
    hasUnknownWorkspaceCreateOutcome(
      new WorkspaceCreateRequestError('Conflict', 'rejected')
    ),
    false
  );
  assert.equal(
    hasUnknownWorkspaceCreateOutcome(
      new WorkspaceCreateRequestError('Temporary failure', 'unknown')
    ),
    true
  );
  assert.equal(
    hasUnknownWorkspaceCreateOutcome(
      new WorkspaceCreateActionError('Malformed success response')
    ),
    true
  );
  assert.equal(
    hasUnknownWorkspaceCreateOutcome(new Error('Connection reset')),
    true
  );
});
