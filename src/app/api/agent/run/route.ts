import { NextRequest } from 'next/server';
import { handleAgentRunRequest } from '@/lib/ai/agent-run-route';
import { defineRoute } from '@/framework/resilience';


export const runtime = 'nodejs';

export const POST = defineRoute(async function POST(req: NextRequest) {
  return handleAgentRunRequest(req);
});
