import { prisma } from '@/lib/db/prisma';
import { mapProjectMount } from './schema';

export async function listProjectMounts(params: {
  organizationId: string;
  sourceProjectId: string;
}) {
  const mounts = await prisma.projectMount.findMany({
    where: {
      organizationId: params.organizationId,
      sourceProjectId: params.sourceProjectId,
    },
    include: {
      sourceProject: {
        select: {
          id: true,
          projectTitle: true,
          title: true,
        },
      },
      targetProject: {
        select: {
          id: true,
          projectTitle: true,
          title: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { targetProjectId: 'asc' }],
  });

  return mounts.map(mapProjectMount);
}

export async function canAccessProjectFromProject(params: {
  organizationId: string;
  sourceProjectId: string;
  targetProjectId: string;
}) {
  if (params.sourceProjectId === params.targetProjectId) {
    return true;
  }

  const mount = await prisma.projectMount.findFirst({
    where: {
      organizationId: params.organizationId,
      sourceProjectId: params.sourceProjectId,
      targetProjectId: params.targetProjectId,
    },
    select: {
      id: true,
    },
  });

  return Boolean(mount);
}
