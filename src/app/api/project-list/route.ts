import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';

type ProjectListSeed = {
  id: string;
  projectId: string | null;
  projectTitle: string | null;
  title: string;
  updatedAt: Date;
};

function resolveProjectId(workspace: Pick<ProjectListSeed, 'id' | 'projectId'>) {
  return workspace.projectId || workspace.id;
}

function resolveProjectTitle(workspace: Pick<ProjectListSeed, 'projectTitle' | 'title'>) {
  return workspace.projectTitle?.trim() || workspace.title;
}

async function listProjectsForOrganization(organizationId: string) {
  const workspaces = await prisma.document.findMany({
    where: {
      deletedAt: null,
      organizationId,
    },
    select: {
      id: true,
      projectId: true,
      projectTitle: true,
      title: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  const projects = new Map<string, ProjectListSeed[]>();

  workspaces.forEach((workspace) => {
    const projectId = resolveProjectId(workspace);
    const bucket = projects.get(projectId) || [];
    bucket.push(workspace);
    projects.set(projectId, bucket);
  });

  return Array.from(projects.values())
    .map((projectDocuments) => {
      const latestWorkspace = projectDocuments[0] || null;
      const anchorWorkspace =
        projectDocuments.find((item) => item.projectId === null) || latestWorkspace;

      if (!latestWorkspace || !anchorWorkspace) {
        return null;
      }

      return {
        id: resolveProjectId(anchorWorkspace),
        workspaceId: latestWorkspace.id,
        title: resolveProjectTitle(anchorWorkspace),
        preview: latestWorkspace.title,
        deliverableCount: projectDocuments.length,
        latestDeliverableTitle: latestWorkspace.title || null,
        updatedAt: latestWorkspace.updatedAt,
      };
    })
    .filter((project): project is NonNullable<typeof project> => Boolean(project))
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
}

export async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const projects = await listProjectsForOrganization(actor.organizationId);
  return NextResponse.json({ items: projects });
}
