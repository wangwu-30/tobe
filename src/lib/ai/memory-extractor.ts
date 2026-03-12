import { prisma } from '@/lib/db/prisma';

type ExtractedMemory = {
  category: 'correction' | 'preference' | 'domain_knowledge' | 'constraint';
  content: string;
};

export function parseMemoryExtractionResponse(response: string): ExtractedMemory[] {
  try {
    const parsed = JSON.parse(response);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (memory: ExtractedMemory) =>
        Boolean(memory.category) &&
        Boolean(memory.content) &&
        ['correction', 'preference', 'domain_knowledge', 'constraint'].includes(
          memory.category
        )
    );
  } catch {
    return [];
  }
}

export async function saveExtractedMemories(params: {
  memories: ExtractedMemory[];
  organizationId: string;
  threadId: string;
  wikiId?: string | null;
}) {
  const created = await Promise.all(
    params.memories.map((memory) =>
      prisma.memory.create({
        data: {
          organizationId: params.organizationId,
          documentId: params.wikiId || null,
          category: memory.category,
          content: memory.content,
          sourceThreadId: params.threadId,
          active: true,
        },
      })
    )
  );

  return created;
}

export function buildMemoryExtractionPrompt(
  threadMessages: { role: string; content: string }[],
  anchorText: string
): string {
  const conversation = threadMessages
    .map((message) => `${message.role === 'user' ? 'User' : 'AI'}: ${message.content}`)
    .join('\n');

  return `Analyze this review thread from 成形. Extract reusable memories such as corrections, preferences, domain knowledge, or constraints.

## Highlighted Wiki Text
"${anchorText}"

## Thread Conversation
${conversation}

## Instructions
If the thread contains reusable information, return a JSON array of memory objects. Each object must have:
- "category": one of "correction", "preference", "domain_knowledge", "constraint"
- "content": a concise memory statement

If nothing reusable appears, return []

Return ONLY the JSON array.`;
}
