import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

import {
  isGovernedAgentTool,
  type AgentToolAuditEvent,
  type AgentToolConfirmationPolicy,
  type AgentToolSafetyLevel,
  type AgentToolWritePolicy,
} from '@/agent/tool-policy';
import {
  buildWebCommentRunRequest,
  WEB_COMMENT_STAGING_SYSTEM_PROMPT_LINES,
} from '@/lib/comments/web-comment-prompt';
import type * as StagedChangesTestBackend from '@/lib/workspace/staged-changes-test-entry';

const run = promisify(execFile);

const EXPECTED_TOOL_POLICIES: Record<
  string,
  {
    confirmationPolicy: AgentToolConfirmationPolicy;
    safetyLevel: AgentToolSafetyLevel;
    writePolicy: AgentToolWritePolicy;
  }
> = {
  get_workspace_context: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'read-only',
  },
  list_project_nodes: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'read-only',
  },
  read_node_content: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'read-only',
  },
  lock_current_wiki: {
    confirmationPolicy: 'required',
    safetyLevel: 'confirm',
    writePolicy: 'workspace-write',
  },
  list_files: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'read-only',
  },
  read_file: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'read-only',
  },
  list_workspace_runs: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'read-only',
  },
  propose_document_change: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'workspace-write',
  },
  start_preview: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'workspace-write',
  },
  stop_preview: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'workspace-write',
  },
  list_versions: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'read-only',
  },
  create_version: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'workspace-write',
  },
  branch_conversation: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'organization-scoped-append',
  },
  publish_team_task: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'organization-scoped-append',
  },
  start_execution_job: {
    confirmationPolicy: 'required',
    safetyLevel: 'confirm',
    writePolicy: 'organization-scoped-append',
  },
  search_web: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'read-only',
  },
  list_comment_threads: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'read-only',
  },
  reply_to_comment: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'workspace-write',
  },
  resolve_comment: {
    confirmationPolicy: 'required',
    safetyLevel: 'confirm',
    writePolicy: 'workspace-write',
  },
  add_knowledge_item: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'workspace-write',
  },
  search_knowledge: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'read-only',
  },
  read_knowledge_doc: {
    confirmationPolicy: 'automatic',
    safetyLevel: 'safe',
    writePolicy: 'read-only',
  },
};

const ORG_A = 'gov-org-a';
const ORG_B = 'gov-org-b';
const USER_A = 'gov-user-a';
const DEVICE_A = 'gov-device-a';
const SESSION_A = 'gov-session-a';
const SESSION_B = 'gov-session-b';
const WORKSPACE_A = 'gov-workspace-a';
const WORKSPACE_A2 = 'gov-workspace-a2';
const WORKSPACE_B = 'gov-workspace-b';
const THREAD_A = 'gov-thread-a';
const THREAD_A2 = 'gov-thread-a2';
const THREAD_B = 'gov-thread-b';
const THREAD_DELETED = 'gov-thread-deleted';

let backend: typeof StagedChangesTestBackend;
let client: Client;
let temporaryRoot = '';

test.describe.serial('coordinator tool governance symmetry and scoping', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tobe-pi-agent-tools-')
    );
    const databasePath = path.join(temporaryRoot, 'dev.db');
    process.env.DAO_APP_DATA_ROOT = temporaryRoot;
    process.env.DATABASE_URL = `file:${databasePath}`;
    await run(
      process.execPath,
      ['scripts/bootstrap-local-db.mjs', '--app-data-root', temporaryRoot],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DAO_APP_DATA_ROOT: temporaryRoot,
          DATABASE_URL: `file:${databasePath}`,
        },
      }
    );
    await run(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['vite', 'build', '--config', 'vite.staged-changes-test.config.mts'],
      { cwd: process.cwd() }
    );
    backend = (await import(
      pathToFileURL(
        path.join(
          process.cwd(),
          '.tmp/staged-changes-test/staged-changes.mjs'
        )
      ).href
    )) as typeof StagedChangesTestBackend;
    client = createClient({ url: `file:${databasePath}` });
  });

  test.beforeEach(async () => {
    const { prisma } = backend;
    await prisma.commentMessage.deleteMany({});
    await prisma.commentThread.deleteMany({});
    await prisma.label.deleteMany({});
    await prisma.version.deleteMany({});
    await prisma.workspaceFile.deleteMany({});
    await prisma.document.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.device.deleteMany({});
    await prisma.organizationMembership.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});

    await prisma.organization.createMany({
      data: [
        { id: ORG_A, name: 'Governance Org A', slug: 'gov-org-a' },
        { id: ORG_B, name: 'Governance Org B', slug: 'gov-org-b' },
      ],
    });
    await prisma.user.create({
      data: { id: USER_A, name: 'Governance Owner' },
    });
    await prisma.organizationMembership.create({
      data: {
        organizationId: ORG_A,
        role: 'owner',
        userId: USER_A,
      },
    });
    await prisma.device.create({
      data: {
        id: DEVICE_A,
        label: 'Local Test Device',
        organizationId: ORG_A,
        userId: USER_A,
      },
    });
    await prisma.session.createMany({
      data: [
        {
          createdByUserId: USER_A,
          id: SESSION_A,
          organizationId: ORG_A,
          originDeviceId: DEVICE_A,
          title: 'Org A Session',
        },
        {
          createdByUserId: USER_A,
          id: SESSION_B,
          organizationId: ORG_B,
          originDeviceId: DEVICE_A,
          title: 'Org B Session',
        },
      ],
    });
    await prisma.document.createMany({
      data: [
        {
          content: '[]',
          id: WORKSPACE_A,
          organizationId: ORG_A,
          projectId: WORKSPACE_A,
          sessionId: SESSION_A,
          title: 'Workspace A',
        },
        {
          content: '[]',
          id: WORKSPACE_A2,
          organizationId: ORG_A,
          projectId: WORKSPACE_A,
          sessionId: SESSION_A,
          title: 'Workspace A Sibling',
        },
        {
          content: '[]',
          id: WORKSPACE_B,
          organizationId: ORG_B,
          projectId: WORKSPACE_B,
          sessionId: SESSION_B,
          title: 'Workspace B',
        },
      ],
    });
    await prisma.commentThread.createMany({
      data: [
        {
          anchorText: 'In-scope anchor',
          documentId: WORKSPACE_A,
          id: THREAD_A,
          organizationId: ORG_A,
          status: 'open',
        },
        {
          anchorText: 'Sibling workspace anchor',
          documentId: WORKSPACE_A2,
          id: THREAD_A2,
          organizationId: ORG_A,
          status: 'open',
        },
        {
          anchorText: 'Cross-org anchor',
          documentId: WORKSPACE_B,
          id: THREAD_B,
          organizationId: ORG_B,
          status: 'open',
        },
        {
          anchorText: 'Deleted anchor',
          deletedAt: new Date(),
          documentId: WORKSPACE_A,
          id: THREAD_DELETED,
          organizationId: ORG_A,
          status: 'open',
        },
      ],
    });
  });

  test.afterAll(async () => {
    await backend?.prisma.$disconnect();
    client?.close();
    if (temporaryRoot) {
      await fs.rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  test('every Coordinator tool is enforced through enforceGovernedAgentTool with explicit policy metadata', () => {
    const { tools } = backend.createWorkspaceAgentTools({
      actorUserId: USER_A,
      conversationId: SESSION_A,
      organizationId: ORG_A,
      originDeviceId: DEVICE_A,
      searchProvider: {
        description: 'Stub search provider for governance tests.',
        id: 'stub-search',
        label: 'Stub Search',
        async search({ query }) {
          return {
            answer: `stub:${query}`,
            citations: [],
            providerId: 'stub-search',
            query,
            raw: null,
            results: [],
          };
        },
      },
      workspaceId: WORKSPACE_A,
    });

    const actualPolicies = Object.fromEntries(
      tools.map((tool) => {
        expect(isGovernedAgentTool(tool)).toBe(true);
        return [
          tool.name,
          {
            confirmationPolicy: tool.confirmationPolicy,
            safetyLevel: tool.safetyLevel,
            writePolicy: tool.writePolicy,
          },
        ];
      })
    );

    expect(actualPolicies).toEqual(EXPECTED_TOOL_POLICIES);
  });

  test('confirm-level workspace mutations fail closed without a confirmation authority and emit audit events', async () => {
    const audits: AgentToolAuditEvent[] = [];
    const { tools } = backend.createWorkspaceAgentTools({
      actorUserId: USER_A,
      conversationId: SESSION_A,
      onToolAudit: (event) => audits.push(event),
      organizationId: ORG_A,
      originDeviceId: DEVICE_A,
      workspaceId: WORKSPACE_A,
    });

    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    await expect(
      byName.get('lock_current_wiki')!.execute('lock-call-1', {})
    ).rejects.toMatchObject({
      code: 'agent-tool-confirmation-required',
      name: 'AgentToolConfirmationRequiredError',
      toolName: 'lock_current_wiki',
    });

    await expect(
      byName.get('resolve_comment')!.execute('resolve-call-1', {
        threadId: THREAD_A,
      })
    ).rejects.toMatchObject({
      code: 'agent-tool-confirmation-required',
      name: 'AgentToolConfirmationRequiredError',
      toolName: 'resolve_comment',
    });

    await expect(
      byName.get('start_execution_job')!.execute('job-call-1', {
        documentVersionId: 'version-1',
        goal: 'Run governed job',
        kind: 'document',
      })
    ).rejects.toMatchObject({
      code: 'agent-tool-confirmation-required',
      name: 'AgentToolConfirmationRequiredError',
      toolName: 'start_execution_job',
    });

    // Neither workspace status nor comment status mutated when denied.
    const doc = await backend.prisma.document.findUnique({
      where: { id: WORKSPACE_A },
    });
    const thread = await backend.prisma.commentThread.findUnique({
      where: { id: THREAD_A },
    });
    expect(doc?.status).toBe('draft');
    expect(thread?.status).toBe('open');

    expect(audits.map((event) => [event.toolName, event.outcome])).toEqual([
      ['lock_current_wiki', 'confirmation_required'],
      ['resolve_comment', 'confirmation_required'],
      ['start_execution_job', 'confirmation_required'],
    ]);
  });

  test('reply_to_comment and resolve_comment fail closed across workspace, organization, and soft-delete boundaries', async () => {
    const audits: AgentToolAuditEvent[] = [];
    const { tools } = backend.createWorkspaceAgentTools({
      actorUserId: USER_A,
      confirmationAuthority: {
        consumeConfirmation: () => true,
      },
      conversationId: SESSION_A,
      onToolAudit: (event) => audits.push(event),
      organizationId: ORG_A,
      originDeviceId: DEVICE_A,
      workspaceId: WORKSPACE_A,
    });

    const replyTool = tools.find((tool) => tool.name === 'reply_to_comment')!;
    const resolveTool = tools.find((tool) => tool.name === 'resolve_comment')!;

    for (const forbiddenThreadId of [THREAD_A2, THREAD_B, THREAD_DELETED]) {
      await expect(
        replyTool.execute(`reply-${forbiddenThreadId}`, {
          content: 'cross-scope reply attempt',
          threadId: forbiddenThreadId,
        })
      ).rejects.toThrow('Thread not found in current workspace.');

      await expect(
        resolveTool.execute(`resolve-${forbiddenThreadId}`, {
          threadId: forbiddenThreadId,
        })
      ).rejects.toThrow('Thread not found in current workspace.');
    }

    // Forbidden threads stayed untouched.
    const forbiddenMessages = await backend.prisma.commentMessage.count({
      where: { threadId: { in: [THREAD_A2, THREAD_B, THREAD_DELETED] } },
    });
    expect(forbiddenMessages).toBe(0);
    const forbiddenThreads = await backend.prisma.commentThread.findMany({
      where: { id: { in: [THREAD_A2, THREAD_B] } },
      select: { status: true },
    });
    expect(forbiddenThreads.every((thread) => thread.status === 'open')).toBe(
      true
    );

    // In-scope thread succeeds for reply and confirmed resolve.
    await replyTool.execute('reply-valid', {
      content: 'Grounded in-scope reply',
      threadId: THREAD_A,
    });
    await resolveTool.execute('resolve-valid', {
      threadId: THREAD_A,
    });

    const updatedThread = await backend.prisma.commentThread.findUnique({
      where: { id: THREAD_A },
      include: { messages: true },
    });
    expect(updatedThread?.status).toBe('resolved');
    expect(updatedThread?.messages).toHaveLength(1);
    expect(updatedThread?.messages[0]?.content).toBe('Grounded in-scope reply');

    expect(
      audits.filter((event) => event.outcome === 'executed').map((e) => e.toolName)
    ).toEqual(['reply_to_comment', 'resolve_comment']);
  });

  test('web-component comment prompts align with propose_document_change Staging contract', () => {
    const systemInstructions =
      WEB_COMMENT_STAGING_SYSTEM_PROMPT_LINES.join('\n');
    const requestPrompt = buildWebCommentRunRequest({
      anchorText: 'Hero headline',
      reviewAnchor: null,
      threadMessages: [
        { content: '@assistant Please update the hero copy.', role: 'user' },
      ],
    });

    for (const text of [systemInstructions, requestPrompt]) {
      expect(text).toContain('propose_document_change');
      expect(text).not.toMatch(/Modify the live draft directly/i);
      expect(text).not.toMatch(/update the live draft implementation/i);
    }
  });
});
