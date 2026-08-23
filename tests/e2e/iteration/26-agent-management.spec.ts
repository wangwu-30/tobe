import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createClient } from '@libsql/client';
import { expect, test, type Page, type Route } from '@playwright/test';

import { primeClientState } from './helpers';

type Agent = {
  builtin: boolean;
  capabilities: { schemaVersion: 1; skills: string[] };
  config: {
    room: { configVersion: 1; runtimeId: string };
    schemaVersion: 1;
  };
  createdAt: string;
  description: string;
  enabled: boolean;
  handle: string;
  id: string;
  name: string;
  organizationId: string;
  revision: number;
  schemaVersion: 1;
  updatedAt: string;
};

test.describe('Agent management', () => {
  test('keeps search and availability filters in the URL across reload and browser navigation', async ({
    page,
  }) => {
    await mockAgentApi(page);
    await primeClientState(page);
    await page.goto('/agents');

    const search = page.getByLabel('Search agents');
    await search.fill('assistant');
    await expect(page).toHaveURL(/\/agents\?q=assistant$/);

    await page.getByTestId('agent-filter-disabled').click();
    await expect(page).toHaveURL(/\/agents\?q=assistant&status=disabled$/);
    await expect(page.getByRole('heading', { name: 'No matching agents' })).toBeVisible();

    await page.reload();
    await expect(search).toHaveValue('assistant');
    await expect(page.getByTestId('agent-filter-disabled')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.getByRole('heading', { name: 'No matching agents' })).toBeVisible();

    await page.goto('/agents');
    await expect(search).toHaveValue('');

    await page.goBack();
    await expect(page).toHaveURL(/\/agents\?q=assistant&status=disabled$/);
    await expect(search).toHaveValue('assistant');
    await expect(page.getByTestId('agent-filter-disabled')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('creates, edits, disables, reloads, and protects built-in agents', async ({
    page,
  }) => {
    const api = await mockAgentApi(page);
    await primeClientState(page);
    await page.goto('/agents');

    await expect(page).toHaveURL(/\/agents$/);
    await expect(page.getByRole('heading', { name: 'Agent directory' })).toBeVisible();

    const builtin = page.getByTestId('agent-card-builtin-assistant');
    await expect(builtin).toContainText('AI Assistant');
    expect(api.listUrls).toEqual([expect.stringContaining('includeDisabled=true')]);
    await expect(builtin).toContainText('Built-in');
    await expect(builtin).toContainText('Enabled');
    await expect(page.getByTestId('agent-toggle-builtin-assistant')).toHaveCount(0);

    await page.getByTestId('agent-edit-builtin-assistant').click();
    const builtinDialog = page.getByTestId('agent-editor-dialog');
    await expect(builtinDialog.getByTestId('builtin-agent-protection')).toContainText(
      'must stay enabled'
    );
    await expect(builtinDialog.getByLabel('Handle')).toHaveAttribute('readonly', '');
    await expect(
      builtinDialog.getByRole('switch', { name: 'Availability', exact: true })
    ).toBeDisabled();
    await builtinDialog.getByRole('button', { name: 'Cancel' }).click();

    await page.getByTestId('create-agent-button').click();
    const dialog = page.getByTestId('agent-editor-dialog');
    const name = dialog.getByLabel('Name');
    await expect(name).toBeFocused();
    await dialog.getByRole('button', { name: 'Create agent' }).click();
    await expect(name).toBeFocused();
    await expect(dialog.getByRole('alert')).toContainText('Enter a name');

    await name.fill('Research Partner');
    await dialog.getByLabel('Handle').fill('bad handle!');
    await dialog.getByRole('button', { name: 'Create agent' }).click();
    await expect(dialog.getByLabel('Handle')).toBeFocused();
    await expect(dialog.getByRole('alert')).toContainText('Use a handle such as');

    await dialog.getByLabel('Handle').fill('research-partner');
    await dialog.getByLabel('Description').fill('Finds sources and summarizes decisions.');
    await dialog.getByLabel('Skills').fill('research, summarization, research');
    await dialog.getByRole('button', { name: 'Create agent' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('agents-notice')).toContainText(
      'Research Partner was created.'
    );
    const created = page.getByTestId('agent-card-agent-research-partner');
    await expect(created).toContainText('@research-partner');
    await expect(created).toContainText('summarization');
    expect(api.mutations[0]).toMatchObject({
      method: 'POST',
      pathname: '/api/agents',
      payload: {
        capabilities: { schemaVersion: 1, skills: ['research', 'summarization'] },
        config: {
          room: { configVersion: 1, runtimeId: 'pi-agent-core' },
          schemaVersion: 1,
        },
        enabled: true,
        handle: '@research-partner',
        name: 'Research Partner',
        schemaVersion: 1,
      },
    });

    await created.getByRole('button', { name: 'Edit Research Partner' }).click();
    await dialog.getByLabel('Name').fill('Research Lead');
    await dialog.getByLabel('Description').fill('Leads sourced research and decision briefs.');
    await dialog.getByRole('button', { name: 'Save changes' }).click();

    const edited = page.getByTestId('agent-card-agent-research-partner');
    await expect(edited).toContainText('Research Lead');
    expect(api.mutations[1]).toMatchObject({
      method: 'PATCH',
      pathname: '/api/agents/agent-research-partner',
      payload: {
        expectedRevision: 1,
        name: 'Research Lead',
        schemaVersion: 1,
      },
    });

    await edited.getByRole('button', { name: 'Disable Research Lead' }).click();
    await expect(page.getByTestId('agent-status-agent-research-partner')).toHaveText(
      'Disabled'
    );
    expect(api.mutations[2]).toMatchObject({
      method: 'PATCH',
      pathname: '/api/agents/agent-research-partner',
      payload: { enabled: false, expectedRevision: 2, schemaVersion: 1 },
    });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Agent directory' })).toBeVisible();
    await expect(page.getByTestId('agent-card-agent-research-partner')).toContainText(
      'Research Lead'
    );
    await expect(page.getByTestId('agent-status-agent-research-partner')).toHaveText(
      'Disabled'
    );
    expect(api.listUrls.at(-1)).toContain('includeDisabled=true');
  });

  test('persists owner changes through the real API and protects the built-in coordinator', async ({
    page,
  }) => {
    const suffix = randomUUID().slice(0, 8);
    const handle = `@e2e-owner-${suffix}`;
    const initialName = `Durable Agent ${suffix}`;
    const editedName = `Durable Lead ${suffix}`;
    const editedDescription = `Persisted through the real Agent API (${suffix}).`;

    await primeClientState(page);
    const initialListResponsePromise = page.waitForResponse(isRealAgentListResponse);
    await page.goto('/agents');

    const initialListResponse = await initialListResponsePromise;
    expect(initialListResponse.status()).toBe(200);
    const initialList = (await initialListResponse.json()) as AgentListResponse;
    expect(initialList.permissions.canManage).toBe(true);
    const builtin = initialList.agents.find((agent) => agent.builtin);
    expect(builtin).toMatchObject({
      enabled: true,
      handle: '@assistant',
      organizationId: 'local-org',
    });
    if (!builtin) throw new Error('Expected the built-in coordinator in the real Agent API.');

    const builtinCard = page.getByTestId(`agent-card-${builtin.id}`);
    await expect(builtinCard).toContainText('@assistant');
    await expect(page.getByTestId(`agent-toggle-${builtin.id}`)).toHaveCount(0);
    await page.getByTestId(`agent-edit-${builtin.id}`).click();
    const builtinDialog = page.getByTestId('agent-editor-dialog');
    await expect(builtinDialog.getByTestId('builtin-agent-protection')).toContainText(
      'must stay enabled'
    );
    await expect(builtinDialog.getByLabel('Handle')).toHaveAttribute('readonly', '');
    await expect(
      builtinDialog.getByRole('switch', { name: 'Availability', exact: true })
    ).toBeDisabled();
    await builtinDialog.getByRole('button', { name: 'Cancel' }).click();

    const protection = await page.evaluate(
      async ({ agentId, expectedRevision }) => {
        const patch = async (body: Record<string, unknown>) => {
          const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
            body: JSON.stringify({
              expectedRevision,
              schemaVersion: 1,
              ...body,
            }),
            headers: { 'content-type': 'application/json' },
            method: 'PATCH',
          });
          const payload = (await response.json()) as { error?: string };
          return { error: payload.error, status: response.status };
        };

        return {
          disable: await patch({ enabled: false }),
          renameHandle: await patch({ handle: '@not-the-coordinator' }),
        };
      },
      { agentId: builtin.id, expectedRevision: builtin.revision }
    );
    expect(protection.disable).toEqual({
      error: 'A built-in Agent cannot be disabled.',
      status: 400,
    });
    expect(protection.renameHandle).toEqual({
      error: 'A built-in Agent handle cannot be changed.',
      status: 400,
    });
    await expect.poll(() => readPersistedAgent(builtin.id)).toMatchObject({
      builtin: true,
      enabled: true,
      handle: '@assistant',
      revision: builtin.revision,
    });

    await page.getByTestId('create-agent-button').click();
    const dialog = page.getByTestId('agent-editor-dialog');
    await dialog.getByLabel('Name').fill(initialName);
    await dialog.getByLabel('Handle').fill(handle);
    await dialog
      .getByLabel('Description')
      .fill('Created by a Chromium browser against the real Next API.');
    await dialog.getByLabel('Skills').fill('browser-e2e, persistence, browser-e2e');

    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/agents'
    );
    await dialog.getByRole('button', { name: 'Create agent' }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    const created = ((await createResponse.json()) as AgentResponse).agent;
    expect(created).toMatchObject({
      builtin: false,
      enabled: true,
      handle,
      name: initialName,
      organizationId: 'local-org',
      revision: 1,
    });

    const createdCard = page.getByTestId(`agent-card-${created.id}`);
    await expect(createdCard).toContainText(initialName);
    await expect(createdCard).toContainText('persistence');
    await createdCard.getByRole('button', { name: `Edit ${initialName}` }).click();
    await dialog.getByLabel('Name').fill(editedName);
    await dialog.getByLabel('Description').fill(editedDescription);

    const editResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/agents/${created.id}`
    );
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    const editResponse = await editResponsePromise;
    expect(editResponse.status()).toBe(200);
    const edited = ((await editResponse.json()) as AgentResponse).agent;
    expect(edited).toMatchObject({
      description: editedDescription,
      enabled: true,
      handle,
      name: editedName,
      revision: 2,
    });

    const editedCard = page.getByTestId(`agent-card-${created.id}`);
    await expect(editedCard).toContainText(editedName);
    const disableResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/agents/${created.id}`
    );
    await editedCard.getByRole('button', { name: `Disable ${editedName}` }).click();
    const disableResponse = await disableResponsePromise;
    expect(disableResponse.status()).toBe(200);
    const disabled = ((await disableResponse.json()) as AgentResponse).agent;
    expect(disabled).toMatchObject({ enabled: false, revision: 3 });
    await expect(page.getByTestId(`agent-status-${created.id}`)).toHaveText('Disabled');

    await expect.poll(() => readPersistedAgent(created.id)).toEqual({
      builtin: false,
      capabilities: { schemaVersion: 1, skills: ['browser-e2e', 'persistence'] },
      config: {
        room: { configVersion: 1, runtimeId: 'pi-agent-core' },
        schemaVersion: 1,
      },
      description: editedDescription,
      enabled: false,
      handle,
      name: editedName,
      organizationId: 'local-org',
      revision: 3,
    });

    const reloadResponsePromise = page.waitForResponse(isRealAgentListResponse);
    await page.reload();
    const reloadResponse = await reloadResponsePromise;
    expect(reloadResponse.status()).toBe(200);
    const reloaded = ((await reloadResponse.json()) as AgentListResponse).agents.find(
      (agent) => agent.id === created.id
    );
    expect(reloaded).toMatchObject({
      description: editedDescription,
      enabled: false,
      handle,
      name: editedName,
      revision: 3,
    });
    await expect(page.getByTestId(`agent-card-${created.id}`)).toContainText(editedName);
    await expect(page.getByTestId(`agent-status-${created.id}`)).toHaveText('Disabled');
  });

  test('keeps fields and primary targets accessible on mobile with reduced motion', async ({
    page,
  }) => {
    await mockAgentApi(page);
    await page.setViewportSize({ height: 844, width: 390 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await primeClientState(page);
    await page.goto('/agents');

    const surface = page.getByTestId('agent-management-page');
    await expect(surface).toBeVisible();
    const horizontalOverflow = await surface.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1
    );
    expect(horizontalOverflow).toBe(false);

    const createButton = page.getByTestId('create-agent-button');
    const createBox = await createButton.boundingBox();
    expect(createBox?.height).toBeGreaterThanOrEqual(44);

    const search = page.getByLabel('Search agents');
    expect(await search.evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
    await expect(page.getByTestId('agent-list-status')).toHaveAttribute('aria-live', 'polite');

    await createButton.click();
    const dialog = page.getByTestId('agent-editor-dialog');
    for (const label of ['Name', 'Handle', 'Description', 'Skills']) {
      const field = dialog.getByLabel(label);
      await expect(field).toHaveAttribute('name');
      await expect(field).toHaveAttribute('autocomplete', 'off');
      expect(await field.evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
    }
    await expect(dialog.getByLabel('Name')).toHaveAttribute('spellcheck', 'true');
    await expect(dialog.getByLabel('Handle')).toHaveAttribute('spellcheck', 'false');
    await expect(dialog.getByLabel('Skills')).toHaveAttribute('spellcheck', 'false');

    const cancelBox = await dialog.getByRole('button', { name: 'Cancel' }).boundingBox();
    const saveBox = await dialog.getByRole('button', { name: 'Create agent' }).boundingBox();
    expect(cancelBox?.height).toBeGreaterThanOrEqual(44);
    expect(saveBox?.height).toBeGreaterThanOrEqual(44);

    const reducedMotion = await dialog.evaluate((element) => {
      const style = getComputedStyle(element);
      return { animationName: style.animationName, duration: style.transitionDuration };
    });
    expect(reducedMotion.animationName).toBe('none');
    expect(Number.parseFloat(reducedMotion.duration)).toBeLessThanOrEqual(0.00001);
  });

  test('guards dirty editor dismissal and navigation, and keeps field semantics stable', async ({
    page,
  }) => {
    await mockAgentApi(page);
    await primeClientState(page);
    await page.goto('/agents');

    await page.getByTestId('create-agent-button').click();
    const dialog = page.getByTestId('agent-editor-dialog');
    const name = dialog.getByLabel('Name');
    const handle = dialog.getByLabel('Handle');
    await expect(name).toHaveAttribute('required', '');
    await expect(handle).toHaveAttribute('required', '');

    await dialog.getByTestId('agent-runtime-details').click();
    const runtime = dialog.getByLabel('Room runtime ID');
    await expect(runtime).toHaveAttribute('required', '');

    const availability = dialog.getByRole('switch', { name: 'Availability', exact: true });
    await expect(availability).toHaveAttribute('aria-checked', 'true');
    await availability.click();
    await expect(availability).toHaveAttribute('aria-checked', 'false');
    await expect(availability).toHaveAccessibleName('Availability');

    await name.fill('Unsaved agent');
    page.once('dialog', async (confirmation) => {
      expect(confirmation.message()).toBe('You have unsaved agent changes. Discard them?');
      await confirmation.dismiss();
    });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue('Unsaved agent');

    page.once('dialog', async (confirmation) => {
      expect(confirmation.message()).toBe('You have unsaved agent changes. Discard them?');
      await confirmation.dismiss();
    });
    await page.locator('a[href="/knowledge"]').evaluate((link: HTMLAnchorElement) => {
      link.click();
    });
    await expect(page).toHaveURL(/\/agents$/);
    await expect(dialog).toBeVisible();

    page.once('dialog', (confirmation) => confirmation.accept());
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('contains long runtime identifiers and exposes only one loading status source', async ({
    page,
  }) => {
    const api = await mockAgentApi(page, { deferInitialList: true });
    await primeClientState(page);
    await page.goto('/agents');

    await api.initialListRequested;
    try {
      const loadingStatus = page.locator('[role="status"]', { hasText: 'Loading agents.' });
      await expect(loadingStatus).toHaveCount(1);
      await expect(page.getByTestId('agent-list-status')).toHaveText('Loading agents.');
    } finally {
      api.releaseInitialList();
    }
    await expect(page.getByTestId('create-agent-button')).toBeVisible();
    await page.getByTestId('create-agent-button').click();
    const dialog = page.getByTestId('agent-editor-dialog');
    await dialog.getByTestId('agent-runtime-details').click();
    await dialog.getByLabel('Room runtime ID').fill(`runtime-${'segment-'.repeat(80)}`);

    const horizontalOverflow = await dialog.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1
    );
    expect(horizontalOverflow).toBe(false);
  });
});

async function mockAgentApi(
  page: Page,
  options?: { deferInitialList?: boolean }
) {
  const now = '2026-08-21T12:00:00.000Z';
  const agents: Agent[] = [
    {
      builtin: true,
      capabilities: { schemaVersion: 1, skills: ['document_editing', 'team_tasks'] },
      config: {
        room: { configVersion: 1, runtimeId: 'pi-agent-core' },
        schemaVersion: 1,
      },
      createdAt: now,
      description: 'Built-in document and team task assistant.',
      enabled: true,
      handle: '@assistant',
      id: 'builtin-assistant',
      name: 'AI Assistant',
      organizationId: 'local-org',
      revision: 1,
      schemaVersion: 1,
      updatedAt: now,
    },
  ];
  const listUrls: string[] = [];
  const mutations: Array<{ method: string; pathname: string; payload: Record<string, unknown> }> = [];
  let markInitialListRequested!: () => void;
  let releaseInitialList!: () => void;
  const initialListRequested = new Promise<void>((resolve) => {
    markInitialListRequested = resolve;
  });
  const initialListGate = new Promise<void>((resolve) => {
    releaseInitialList = resolve;
  });

  await page.route('**/api/agents**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/agents') {
      listUrls.push(url.toString());
      if (listUrls.length === 1) {
        markInitialListRequested();
        if (options?.deferInitialList) {
          await initialListGate;
        }
      }
      await json(route, 200, {
        agents,
        permissions: { canManage: true },
        schemaVersion: 1,
      });
      return;
    }

    const payload = (request.postDataJSON() || {}) as Record<string, unknown>;
    mutations.push({ method: request.method(), pathname: url.pathname, payload });

    if (request.method() === 'POST' && url.pathname === '/api/agents') {
      const created = fromMutation('agent-research-partner', payload, now);
      agents.push(created);
      await json(route, 201, { agent: created, schemaVersion: 1 });
      return;
    }

    if (request.method() === 'PATCH' && url.pathname.startsWith('/api/agents/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/agents/'.length));
      const index = agents.findIndex((agent) => agent.id === id);
      if (index < 0) {
        await json(route, 404, { error: 'Agent not found.' });
        return;
      }

      const current = agents[index];
      if (payload.expectedRevision !== current.revision) {
        await json(route, 409, { error: 'Agent changed while it was being updated.' });
        return;
      }
      if (current.builtin && (payload.handle || payload.enabled === false)) {
        await json(route, 400, { error: 'Built-in agent protection failed.' });
        return;
      }

      const updated = fromMutation(current.id, payload, now, current);
      agents[index] = updated;
      await json(route, 200, { agent: updated, schemaVersion: 1 });
      return;
    }

    await route.fallback();
  });

  return { agents, initialListRequested, listUrls, mutations, releaseInitialList };
}

function fromMutation(
  id: string,
  payload: Record<string, unknown>,
  now: string,
  current?: Agent
): Agent {
  const capabilities = payload.capabilities
    ? (payload.capabilities as Agent['capabilities'])
    : current?.capabilities || { schemaVersion: 1 as const, skills: [] };
  const config =
    (payload.config as Agent['config'] | undefined) ||
    current?.config || {
      room: { configVersion: 1 as const, runtimeId: 'pi-agent-core' },
      schemaVersion: 1 as const,
    };

  return {
    builtin: current?.builtin || false,
    capabilities,
    config,
    createdAt: current?.createdAt || now,
    description:
      typeof payload.description === 'string'
        ? payload.description
        : current?.description || '',
    enabled:
      typeof payload.enabled === 'boolean' ? payload.enabled : current?.enabled ?? true,
    handle: typeof payload.handle === 'string' ? payload.handle : current?.handle || '',
    id,
    name: typeof payload.name === 'string' ? payload.name : current?.name || '',
    organizationId: 'local-org',
    revision: (current?.revision || 0) + 1,
    schemaVersion: 1,
    updatedAt: now,
  };
}

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  });
}

type AgentListResponse = {
  agents: Agent[];
  permissions: { canManage: boolean };
  schemaVersion: 1;
};

type AgentResponse = {
  agent: Agent;
  schemaVersion: 1;
};

function isRealAgentListResponse(response: { request(): { method(): string }; url(): string }) {
  const url = new URL(response.url());
  return (
    response.request().method() === 'GET' &&
    url.pathname === '/api/agents' &&
    url.searchParams.get('includeDisabled') === 'true'
  );
}

async function readPersistedAgent(agentId: string) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await client.execute({
      sql: `SELECT "organizationId", "handle", "name", "description",
                   "capabilitiesJson", "configJson", "enabled", "builtin", "revision"
            FROM "AgentProfile"
            WHERE "id" = ? AND "organizationId" = 'local-org'`,
      args: [agentId],
    });
    const row = result.rows[0];
    if (!row) return null;

    return {
      builtin: Number(row.builtin) === 1,
      capabilities: JSON.parse(String(row.capabilitiesJson)),
      config: JSON.parse(String(row.configJson)),
      description: String(row.description),
      enabled: Number(row.enabled) === 1,
      handle: String(row.handle),
      name: String(row.name),
      organizationId: String(row.organizationId),
      revision: Number(row.revision),
    };
  } finally {
    await client.close();
  }
}

function resolveIterationDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();

  const iterationRoot =
    process.env.ITERATION_ROOT ||
    path.join(process.cwd(), '.tmp', 'iteration-regression');
  const appDataRoot =
    process.env.DAO_APP_DATA_ROOT || path.join(iterationRoot, 'app-data');
  return `file:${path.join(appDataRoot, 'dev.db')}`;
}
