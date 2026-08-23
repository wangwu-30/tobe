import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { defineRoute } from '@/framework/resilience';

/**
 * GET /api/canvas-layout
 * Return all project positions for the global canvas.
 */
export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);

  const layouts = await prisma.projectCanvasLayout.findMany({
    where: {
      organizationId: actor.organizationId,
      project: {
        deletedAt: null,
        organizationId: actor.organizationId,
        projectId: { equals: prisma.document.fields.id },
      },
    },
    select: {
      projectId: true,
      x: true,
      y: true,
    },
  });

  const positions: Record<string, { x: number; y: number }> = {};
  for (const layout of layouts) {
    positions[layout.projectId] = { x: layout.x, y: layout.y };
  }

  return NextResponse.json({ positions });
});

/**
 * PATCH /api/canvas-layout
 * Batch upsert project positions.
 * Body: { positions: Record<string, { x: number; y: number }> }
 */
export const PATCH = defineRoute(async function PATCH(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json().catch(() => ({}));
  const raw = body.positions as Record<string, { x: number; y: number }> | undefined;

  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ error: 'positions object is required.' }, { status: 400 });
  }

  const entries = Object.entries(raw).filter(
    ([, pos]) =>
      pos &&
      typeof pos.x === 'number' &&
      typeof pos.y === 'number' &&
      Number.isFinite(pos.x) &&
      Number.isFinite(pos.y)
  );

  const updated = await prisma.$transaction(async (tx) => {
    const projectIds = entries.map(([projectId]) => projectId);
    const projects = await tx.document.findMany({
      where: {
        deletedAt: null,
        id: { in: projectIds },
        organizationId: actor.organizationId,
      },
      select: {
        id: true,
        projectId: true,
      },
    });
    const validProjectIds = new Set(
      projects
        .filter((project) => project.projectId === project.id)
        .map((project) => project.id)
    );

    if (validProjectIds.size !== projectIds.length) {
      return false;
    }

    await Promise.all(
      entries.map(([projectId, pos]) =>
        tx.projectCanvasLayout.upsert({
          where: {
            organizationId_projectId: {
              organizationId: actor.organizationId,
              projectId,
            },
          },
          create: {
            organizationId: actor.organizationId,
            projectId,
            x: pos.x,
            y: pos.y,
          },
          update: {
            x: pos.x,
            y: pos.y,
          },
        })
      )
    );

    return true;
  });

  if (!updated) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
});
