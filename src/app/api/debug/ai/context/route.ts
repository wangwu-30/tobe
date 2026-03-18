import { NextRequest, NextResponse } from 'next/server';
import { buildChatSystemPrompt } from '@/lib/ai/context-builder';
import { createWorkspaceAgentTools } from '@/lib/ai/pi-agent-tools';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';

export const runtime = 'nodejs';

type DebugToolCall = {
  name?: string;
  params?: unknown;
};

export async function POST(req: NextRequest) {
  if (process.env.DAO_E2E !== '1') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = (await req.json().catch(() => ({}))) as {
    conversationId?: string;
    toolCalls?: DebugToolCall[];
    workspaceId?: string;
  };
  const conversationId = body.conversationId?.trim() || '';
  const workspaceId = body.workspaceId?.trim() || '';

  if (!conversationId || !workspaceId) {
    return NextResponse.json(
      { error: 'workspaceId and conversationId are required.' },
      { status: 400 }
    );
  }

  const systemPrompt = await buildChatSystemPrompt({
    conversationId,
    language: 'zh-CN',
    organizationId: actor.organizationId,
    researchMode: 'light',
    workspaceId,
  });

  const workspaceAgent = createWorkspaceAgentTools({
    actorUserId: actor.userId,
    conversationId,
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
    researchMode: 'light',
    workspaceId,
  });

  const toolResults = [];
  for (const toolCall of body.toolCalls || []) {
    const name = toolCall.name?.trim() || '';
    if (!name) {
      continue;
    }

    const tool = workspaceAgent.tools.find((candidate) => candidate.name === name);
    if (!tool) {
      return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 400 });
    }

    const result = await tool.execute(`debug-${name}`, toolCall.params || {});
    toolResults.push({
      details: result.details,
      name,
      text: result.content
        .map((item) => (item.type === 'text' ? item.text : '[non-text content]'))
        .join('\n'),
    });
  }

  return NextResponse.json({
    systemPrompt,
    toolResults,
  });
}
