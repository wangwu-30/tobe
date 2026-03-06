import { generateText } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { getModelFromHeaders } from '@/lib/ai/providers';
import { buildSuggestionContext } from '@/lib/ai/context-builder';

export async function POST(req: NextRequest) {
  const { documentContent, anchorText, threadDiscussion, model: modelOverride } = await req.json();

  const systemPrompt = await buildSuggestionContext({
    documentContent,
    anchorText,
    threadDiscussion,
  });

  const model = getModelFromHeaders(req.headers, modelOverride);

  const { text } = await generateText({
    model,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Based on the discussion, generate the replacement text for "${anchorText}". Return ONLY the replacement text.`,
      },
    ],
  });

  return NextResponse.json({ suggestion: text.trim() });
}
