import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  KNOWLEDGE_CHANGE_REQUEST_STATUSES,
  listKnowledgeChangeRequests,
  type KnowledgeChangeRequestStatus,
} from '@/objects/knowledge';

export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status')?.trim() || undefined;
  if (status && !KNOWLEDGE_CHANGE_REQUEST_STATUSES.includes(status as never)) {
    throw new ValidationError('Invalid knowledge change request status.');
  }
  const changeRequests = await listKnowledgeChangeRequests(actor, {
    spaceId: searchParams.get('spaceId')?.trim() || undefined,
    status: status as KnowledgeChangeRequestStatus | undefined,
  });
  return NextResponse.json({ changeRequests });
});
