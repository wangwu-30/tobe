import {
  NotFoundError,
  ValidationError,
} from '@/framework/resilience';
import { prisma } from '@/lib/db/prisma';
import { mapProjectMount } from './schema';

async function findProjectRoot(organizationId: string, projectId: string) {
  return prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: projectId,
      organizationId,
    },
    select: {
      id: true,
      projectTitle: true,
      title: true,
    },
  });
}

export async function createProjectMount(params: {
  organizationId: string;
  sourceProjectId: string;
  targetProjectId: string;
}) {
  if (params.sourceProjectId === params.targetProjectId) {
    throw new ValidationError('A project cannot mount itself.');
  }

  const [sourceProject, targetProject] = await Promise.all([
    findProjectRoot(params.organizationId, params.sourceProjectId),
    findProjectRoot(params.organizationId, params.targetProjectId),
  ]);

  if (!sourceProject) {
    throw new NotFoundError('Source project not found.');
  }

  if (!targetProject) {
    throw new NotFoundError('Target project not found.');
  }

  const existing = await prisma.projectMount.findFirst({
    where: {
      organizationId: params.organizationId,
      sourceProjectId: params.sourceProjectId,
      targetProjectId: params.targetProjectId,
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
  });

  if (existing) {
    return mapProjectMount(existing);
  }

  const mount = await prisma.projectMount.create({
    data: {
      organizationId: params.organizationId,
      sourceProjectId: sourceProject.id,
      targetProjectId: targetProject.id,
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
  });

  return mapProjectMount(mount);
}
