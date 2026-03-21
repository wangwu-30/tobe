import { NextRequest } from 'next/server';
import { handleAgentRunRequest } from '@/lib/ai/agent-run-route';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  return handleAgentRunRequest(req);
}
