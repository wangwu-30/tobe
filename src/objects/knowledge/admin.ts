import { ForbiddenError } from '@/framework/resilience';
import { prisma } from '@/lib/db/prisma';

import type { KnowledgeHumanActor } from './queries';

const KNOWLEDGE_REVIEWER_ROLES = ['owner', 'admin'] as const;

export async function requireKnowledgeAdmin(
  actor: KnowledgeHumanActor
): Promise<void> {
  await requireKnowledgeRole(
    actor,
    KNOWLEDGE_REVIEWER_ROLES,
    'Knowledge configuration requires organization admin access.'
  );
}

export async function requireKnowledgeReviewer(
  actor: KnowledgeHumanActor
): Promise<void> {
  await requireKnowledgeRole(
    actor,
    KNOWLEDGE_REVIEWER_ROLES,
    'Knowledge review requires an organization owner or admin.'
  );
}

async function requireKnowledgeRole(
  actor: KnowledgeHumanActor,
  allowedRoles: readonly string[],
  message: string
): Promise<void> {
  if (actor.actorType !== 'user' || !actor.userId.trim()) {
    throw new ForbiddenError(message);
  }
  const rows = await prisma.$queryRaw<Array<{ role: string }>>`
    SELECT "role" FROM "OrganizationMembership"
    WHERE "organizationId" = ${actor.organizationId}
      AND "userId" = ${actor.userId}
    LIMIT 1
  `;
  if (!rows[0] || !allowedRoles.includes(rows[0].role)) {
    throw new ForbiddenError(message);
  }
}
