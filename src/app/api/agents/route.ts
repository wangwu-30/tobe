import { NextRequest, NextResponse } from 'next/server';

import { defineRoute } from '@/framework/resilience';
import { getRoomActorFromHeaders } from '@/app/api/rooms/_shared';
import {
  AGENT_PROFILE_CONTRACT_VERSION_V1,
  createAgentProfileV1,
  listAgentProfilesV1,
  parseCreateAgentProfileInputV1,
} from '@/objects/agent-profile';

export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getRoomActorFromHeaders(req.headers);
  const includeDisabled =
    new URL(req.url).searchParams.get('includeDisabled') === 'true';
  const result = await listAgentProfilesV1(actor, { includeDisabled });

  return NextResponse.json({
    schemaVersion: AGENT_PROFILE_CONTRACT_VERSION_V1,
    ...result,
  });
});

export const POST = defineRoute(async function POST(req: NextRequest) {
  const actor = await getRoomActorFromHeaders(req.headers);
  const input = parseCreateAgentProfileInputV1(await readJson(req));
  const agent = await createAgentProfileV1(actor, input);

  return NextResponse.json(
    { schemaVersion: AGENT_PROFILE_CONTRACT_VERSION_V1, agent },
    { status: 201 }
  );
});

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
