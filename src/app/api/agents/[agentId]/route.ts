import { NextRequest, NextResponse } from 'next/server';

import { getRoomActorFromHeaders } from '@/app/api/rooms/_shared';
import { defineRoute } from '@/framework/resilience';
import {
  AGENT_PROFILE_CONTRACT_VERSION_V1,
  getAgentProfileV1,
  parseUpdateAgentProfileInputV1,
  updateAgentProfileV1,
} from '@/objects/agent-profile';

type AgentRouteContext = { params: Promise<{ agentId: string }> };

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: AgentRouteContext
) {
  const actor = await getRoomActorFromHeaders(req.headers);
  const { agentId } = await params;
  const result = await getAgentProfileV1(actor, agentId);
  return NextResponse.json({
    schemaVersion: AGENT_PROFILE_CONTRACT_VERSION_V1,
    ...result,
  });
});

export const PATCH = defineRoute(async function PATCH(
  req: NextRequest,
  { params }: AgentRouteContext
) {
  const actor = await getRoomActorFromHeaders(req.headers);
  const { agentId } = await params;
  const input = parseUpdateAgentProfileInputV1(await readJson(req));
  const agent = await updateAgentProfileV1(actor, agentId, input);
  return NextResponse.json({
    schemaVersion: AGENT_PROFILE_CONTRACT_VERSION_V1,
    agent,
  });
});

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
