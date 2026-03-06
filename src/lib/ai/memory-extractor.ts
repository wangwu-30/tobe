import { prisma } from '@/lib/db/prisma';

type ExtractedMemory = {
  category: 'correction' | 'preference' | 'domain_knowledge' | 'constraint';
  content: string;
};

// Parse AI response to extract memories
export function parseMemoryExtractionResponse(response: string): ExtractedMemory[] {
  try {
    const parsed = JSON.parse(response);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (m: any) =>
          m.category &&
          m.content &&
          ['correction', 'preference', 'domain_knowledge', 'constraint'].includes(m.category)
      );
    }
    return [];
  } catch {
    return [];
  }
}

// Save extracted memories to database
export async function saveExtractedMemories(
  memories: ExtractedMemory[],
  threadId: string,
  sessionId?: string
) {
  const created = await Promise.all(
    memories.map(m =>
      prisma.memory.create({
        data: {
          category: m.category,
          content: m.content,
          sourceThreadId: threadId,
          sessionId: sessionId || null,
          active: true,
        },
      })
    )
  );
  return created;
}

// Build the prompt for memory extraction
export function buildMemoryExtractionPrompt(
  threadMessages: { role: string; content: string }[],
  anchorText: string
): string {
  const conversation = threadMessages
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
    .join('\n');

  return `Analyze this comment thread from a document review. Extract any reusable knowledge, corrections, preferences, or constraints that the user has expressed.

## Commented Text
"${anchorText}"

## Thread Conversation
${conversation}

## Instructions
If the thread contains learnable information (corrections to AI mistakes, user preferences, domain knowledge, or constraints), return a JSON array of memory objects. Each object should have:
- "category": one of "correction", "preference", "domain_knowledge", "constraint"
- "content": a concise statement of the memory (e.g., "The project uses PostgreSQL, not MySQL")

If there is nothing to learn from this thread, return an empty array: []

Return ONLY the JSON array, no other text.`;
}
