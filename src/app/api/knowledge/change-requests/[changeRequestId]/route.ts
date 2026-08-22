import { NextRequest, NextResponse } from 'next/server';

import { readTrustedKnowledgeDiffV1 } from '@/agent/knowledge';
import { NotFoundError, defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  getActiveKnowledgeSnapshot,
  getKnowledgeChangeRequest,
  getKnowledgeSpace,
  listKnowledgeMergeOperations,
} from '@/objects/knowledge';

type RouteContext = { params: Promise<{ changeRequestId: string }> };

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: RouteContext
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { changeRequestId } = await params;
  const changeRequest = await getKnowledgeChangeRequest(actor, changeRequestId);
  if (!changeRequest) throw new NotFoundError('Knowledge change request not found.');
  const space = await getKnowledgeSpace(actor, changeRequest.spaceId);
  if (!space) throw new NotFoundError('Knowledge space not found.');
  const [diff, mergeOperations, activeSnapshot] = await Promise.all([
    readTrustedKnowledgeDiffV1({ space, changeRequest }),
    listKnowledgeMergeOperations(actor, { changeRequestId }),
    getActiveKnowledgeSnapshot(actor, changeRequest.spaceId),
  ]);
  return NextResponse.json({
    changeRequest,
    diff,
    mergeOperations,
    activeSnapshot,
    space: {
      id: space.id,
      scope: space.scope,
      ownerAgentId: space.ownerAgentId,
      defaultBranch: space.defaultBranch,
      activeSnapshotId: space.activeSnapshotId,
    },
  });
});
