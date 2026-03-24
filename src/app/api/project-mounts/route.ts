import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { defineRoute } from '@/framework/resilience';

/**
 * GET /api/project-mounts
 * List all project mounts for the current organization.
 */
export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);

  const mounts = await prisma.projectMount.findMany({
    where: { organizationId: actor.organizationId },
    select: {
      id: true,
      sourceProjectId: true,
      targetProjectId: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ mounts });
});
