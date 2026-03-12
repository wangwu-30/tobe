import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  withIdempotency,
} from '@/lib/platform/idempotency';
import { materializeWorkspaceMirror } from '@/lib/platform/mirror-manager';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { recordSyncEvent } from '@/lib/platform/sync';
import { WORKSPACE_CREATE_IDEMPOTENCY_HEADER } from '@/lib/workspace/create-request';
import { createInitialWorkspacePlan } from '@/lib/workspace/planning';
import { listWorkspaces, mapConversation, mapWorkspace, mapWorkspaceFile } from '@/lib/workspace/service';
import type { DeliverableType } from '@/types';

export async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const workspaces = await listWorkspaces(actor.organizationId);
  return NextResponse.json({ items: workspaces });
}

export async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json().catch(() => ({}));
  const deliverableType =
    body.deliverableType === 'web' ||
    body.deliverableType === 'code' ||
    body.deliverableType === 'slides'
      ? body.deliverableType
      : 'document';
  const suggestedTitle = deriveWorkspaceTitle(body.title || body.goal);
  const requestKey = req.headers.get(WORKSPACE_CREATE_IDEMPOTENCY_HEADER)?.trim() || null;
  const requestHash = JSON.stringify({
    constraints: body.constraints || null,
    deliverableType,
    goal: body.goal || null,
    styleGuide: body.styleGuide || null,
    title: suggestedTitle || null,
  });

  try {
    const workspace = await withIdempotency({
      action: async () => {
        const created = await createWorkspaceForRequest(actor, {
          constraints: body.constraints,
          conversationTitle: body.conversationTitle,
          deliverableType,
          goal: body.goal,
          initialContent: typeof body.content === 'string' ? body.content : null,
          styleGuide: body.styleGuide,
          title: suggestedTitle || undefined,
        });
        await finalizeWorkspaceCreation(actor, created).catch((error) => {
          console.error('Workspace creation side effects failed.', error);
        });

        return {
          conversation: mapConversation(created.conversation),
          primaryFile: mapWorkspaceFile(created.primaryFile),
          workspace: mapWorkspace(created.workspace),
        };
      },
      key: requestKey,
      operation: 'workspace:create',
      organizationId: actor.organizationId,
      requestHash,
      resource: (result) => ({
        resourceId:
          result && typeof result === 'object' && 'workspace' in result
            ? ((result.workspace as { id?: string }).id || null)
            : null,
        resourceType: 'workspace',
      }),
      userId: actor.userId,
    });

    return NextResponse.json(workspace);
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json(
        {
          error:
            'This project request key is already being used for a different project payload.',
        },
        { status: 409 }
      );
    }

    if (error instanceof IdempotencyInProgressError) {
      return NextResponse.json(
        { error: 'This project request is still in progress. Please wait a moment.' },
        { status: 409 }
      );
    }

    console.error('Workspace creation failed.', error);
    return NextResponse.json(
      { error: 'Could not create the project.' },
      { status: 500 }
    );
  }
}

async function createWorkspaceForRequest(
  actor: { deviceId: string; organizationId: string; userId: string },
  input: {
    constraints?: string | null;
    conversationTitle?: unknown;
    deliverableType: DeliverableType;
    goal?: unknown;
    initialContent?: string | null;
    styleGuide?: string | null;
    title?: string;
  }
) {
  const title = input.title?.trim() || 'Untitled Project';
  const goal =
    typeof input.goal === 'string' && input.goal.trim().length > 0
      ? input.goal.trim()
      : null;
  const planGoal = goal || title || 'Create a new deliverable';
  const initialPlan = createInitialWorkspacePlan({
    constraints: input.constraints || null,
    deliverableType: input.deliverableType,
    goal: planGoal,
    styleGuide: input.styleGuide || null,
  });
  const fileSeeds = buildWorkspaceFileSeeds({
    deliverableType: input.deliverableType,
    heading: title,
    initialContent: input.initialContent || null,
  });

  return prisma.$transaction(async (tx) => {
    const conversation = await tx.session.create({
      data: {
        organizationId: actor.organizationId,
        title:
          typeof input.conversationTitle === 'string' &&
          input.conversationTitle.trim().length > 0
            ? input.conversationTitle.trim()
            : title,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
        sourceType: 'chat',
      },
    });

    const workspace = await tx.document.create({
      data: {
        organizationId: actor.organizationId,
        sessionId: conversation.id,
        title,
        content: fileSeeds.primary.content,
        status: 'draft',
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    const primaryFile = await tx.workspaceFile.create({
      data: {
        organizationId: actor.organizationId,
        documentId: workspace.id,
        name: fileSeeds.primary.name,
        path: fileSeeds.primary.name,
        type: 'file',
        kind: fileSeeds.primary.kind,
        role: 'deliverable',
        language: fileSeeds.primary.language,
        content: fileSeeds.primary.content,
        isPrimary: true,
        sortOrder: 0,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    const additionalFiles = [];
    for (const [index, file] of fileSeeds.additional.entries()) {
      additionalFiles.push(
        await tx.workspaceFile.create({
          data: {
            organizationId: actor.organizationId,
            documentId: workspace.id,
            name: file.name,
            path: file.name,
            type: 'file',
            kind: file.kind,
            role: 'deliverable',
            language: file.language,
            content: file.content,
            isPrimary: false,
            sortOrder: index + 1,
            createdByUserId: actor.userId,
            originDeviceId: actor.deviceId,
          },
        })
      );
    }

    const updatedConversation = await tx.session.update({
      where: { id: conversation.id },
      data: {
        activeFileId: primaryFile.id,
        wikiId: workspace.id,
      },
    });

    await tx.workspacePlan.create({
      data: {
        organizationId: actor.organizationId,
        documentId: workspace.id,
        goal: initialPlan.goal,
        deliverableType: initialPlan.deliverableType,
        constraints: initialPlan.constraints,
        styleGuide: initialPlan.styleGuide,
        status: initialPlan.status,
        version: initialPlan.version,
        stagesJson: JSON.stringify(initialPlan.stages),
        activeStageId: initialPlan.activeStageId,
        lastProgressNote: initialPlan.lastProgressNote,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    return {
      conversation: updatedConversation,
      files: [primaryFile, ...additionalFiles],
      primaryFile,
      workspace,
    };
  });
}

async function finalizeWorkspaceCreation(
  actor: { deviceId: string; organizationId: string; userId: string },
  created: Awaited<ReturnType<typeof createWorkspaceForRequest>>
) {
  await Promise.allSettled([
    recordSyncEvent({
      actorUserId: actor.userId,
      entityId: created.workspace.id,
      entityType: 'workspace',
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
      payload: {
        op: 'create',
        title: created.workspace.title,
      },
      revision: created.workspace.revision,
    }),
    recordSyncEvent({
      actorUserId: actor.userId,
      entityId: created.conversation.id,
      entityType: 'conversation',
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
      payload: {
        op: 'create',
        title: created.conversation.title,
        workspaceId: created.workspace.id,
      },
      revision: created.conversation.revision,
    }),
    ...created.files.map((file) =>
      recordSyncEvent({
        actorUserId: actor.userId,
        entityId: file.id,
        entityType: 'workspace_file',
        organizationId: actor.organizationId,
        originDeviceId: actor.deviceId,
        payload: {
          op: 'create',
          path: file.path,
          workspaceId: created.workspace.id,
        },
        revision: file.revision,
      })
    ),
  ]);

  await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: created.workspace.id,
  });
}

function buildWorkspaceFileSeeds(params: {
  deliverableType: DeliverableType;
  heading: string;
  initialContent?: string | null;
}) {
  if (params.deliverableType === 'web') {
    return {
      additional: [
        {
          content: buildReactWebIndexHtml(),
          kind: 'code' as const,
          language: 'html',
          name: 'index.html',
        },
        {
          content: buildReactWebMainModule(),
          kind: 'code' as const,
          language: 'javascript',
          name: 'main.js',
        },
        {
          content: buildReactWebStyles(),
          kind: 'code' as const,
          language: 'css',
          name: 'styles.css',
        },
      ],
      primary: {
        content: buildReactWebAppModule(params.heading),
        kind: 'code' as const,
        language: 'javascript',
        name: 'App.js',
      },
    };
  }

  if (params.deliverableType === 'code') {
    return {
      additional: [],
      primary: {
        content: params.initialContent || '',
        kind: 'code' as const,
        language: 'typescript',
        name: 'index.ts',
      },
    };
  }

  if (params.deliverableType === 'slides') {
    return {
      additional: [],
      primary: {
        content: params.initialContent || '[]',
        kind: 'markdown' as const,
        language: 'markdown',
        name: 'slides.md',
      },
    };
  }

  return {
    additional: [],
    primary: {
      content: params.initialContent || '[]',
      kind: 'markdown' as const,
      language: 'markdown',
      name: 'main.md',
    },
  };
}

function deriveWorkspaceTitle(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/[。！？!?,，；;：:]+$/g, '')
    .trim();

  if (!normalized) {
    return null;
  }

  const strippedLead = normalized.replace(
    /^(写一份|写一个|写一篇|做一份|做一个|做一页|生成一份|生成一个|创建一份|创建一个|起草一份|产出一份)\s*/u,
    ''
  );
  const firstClause = strippedLead.split(/[，。,.：:]/u)[0]?.trim() || strippedLead;
  const candidate = firstClause || strippedLead;

  return candidate.length > 28 ? `${candidate.slice(0, 25).trimEnd()}...` : candidate;
}

function buildReactWebIndexHtml() {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '    <title>Dao Web Deliverable</title>',
    '    <script type="importmap">',
    '      {',
    '        "imports": {',
    '          "react": "https://esm.sh/react@19?dev",',
    '          "react-dom/client": "https://esm.sh/react-dom@19/client?dev",',
    '          "htm": "https://esm.sh/htm@3?dev"',
    '        }',
    '      }',
    '    </script>',
    '    <link rel="stylesheet" href="./styles.css" />',
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '    <script type="module" src="./main.js"></script>',
    '  </body>',
    '</html>',
  ].join('\n');
}

function buildReactWebMainModule() {
  return [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { App } from './App.js';",
    '',
    "const rootElement = document.getElementById('root');",
    '',
    'if (!rootElement) {',
    "  throw new Error('Missing #root element for the React preview.');",
    '}',
    '',
    'createRoot(rootElement).render(',
    '  React.createElement(React.StrictMode, null, React.createElement(App))',
    ');',
  ].join('\n');
}

function buildReactWebAppModule(title: unknown) {
  const heading =
    typeof title === 'string' && title.trim().length > 0
      ? title.trim()
      : 'New React Deliverable';

  return [
    "import React from 'react';",
    "import htm from 'htm';",
    '',
    'const html = htm.bind(React.createElement);',
    `const heading = ${JSON.stringify(heading)};`,
    '',
    'export function App() {',
    '  return html`',
    '    <main className="page-shell">',
    '      <section className="hero-card">',
    '        <p className="eyebrow">React web deliverable</p>',
    '        <h1>${heading}</h1>',
    '        <p className="lede">',
    '          This workspace starts with a previewable React scaffold. Replace the sections,',
    '          layout, and styling with the real page during the first author pass.',
    '        </p>',
    '      </section>',
    '    </main>',
    '  `;',
    '}',
  ].join('\n');
}

function buildReactWebStyles() {
  return [
    ':root {',
    '  color-scheme: light;',
    "  font-family: 'SF Pro Display', 'Helvetica Neue', sans-serif;",
    '  background: linear-gradient(180deg, #f5f1e8 0%, #f9f7f3 100%);',
    '  color: #171717;',
    '}',
    '',
    '* {',
    '  box-sizing: border-box;',
    '}',
    '',
    'body {',
    '  margin: 0;',
    '  min-height: 100vh;',
    '  background: radial-gradient(circle at top, rgba(201, 153, 66, 0.16), transparent 32%),',
    '    linear-gradient(180deg, #f5f1e8 0%, #f9f7f3 100%);',
    '}',
    '',
    '.page-shell {',
    '  min-height: 100vh;',
    '  display: grid;',
    '  place-items: center;',
    '  padding: 32px;',
    '}',
    '',
    '.hero-card {',
    '  width: min(720px, 100%);',
    '  padding: 48px;',
    '  border-radius: 32px;',
    '  background: rgba(255, 255, 255, 0.88);',
    '  border: 1px solid rgba(23, 23, 23, 0.08);',
    '  box-shadow: 0 24px 80px rgba(60, 44, 12, 0.12);',
    '}',
    '',
    '.eyebrow {',
    '  margin: 0 0 12px;',
    '  font-size: 12px;',
    '  letter-spacing: 0.24em;',
    '  text-transform: uppercase;',
    '  color: #8a6a2f;',
    '}',
    '',
    'h1 {',
    '  margin: 0;',
    '  font-size: clamp(2.6rem, 5vw, 4.4rem);',
    '  line-height: 0.95;',
    '}',
    '',
    '.lede {',
    '  margin: 18px 0 0;',
    '  max-width: 56ch;',
    '  font-size: 16px;',
    '  line-height: 1.7;',
    '  color: rgba(23, 23, 23, 0.72);',
    '}',
    '',
    '@media (max-width: 640px) {',
    '  .page-shell {',
    '    padding: 18px;',
    '  }',
    '',
    '  .hero-card {',
    '    padding: 28px;',
    '    border-radius: 24px;',
    '  }',
    '}',
  ].join('\n');
}
