import { ROOM_CONTEXT_CONTRACT_VERSION_V1 } from './contracts';
import type {
  RoomContextBudgetConfigV1,
  RoomContextBudgetUsageV1,
  RoomContextCategoryBudgetUsageV1,
  RoomContextCategoryV1,
} from './contracts';

export const ROOM_CONTEXT_CATEGORIES_V1 = [
  'summary',
  'reply-chain',
  'room-delta',
  'document-slice',
  'retrieval-hit',
  'current-message',
] as const satisfies readonly RoomContextCategoryV1[];

export const DEFAULT_ROOM_CONTEXT_BUDGET_V1: RoomContextBudgetConfigV1 = {
  schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
  configVersion: 'room-context-builder-v1',
  summaryConfigVersion: 'room-summary-v1',
  // Total ceilings match the exact sum of category ceilings (20,000 chars / 34 blocks)
  // so high-volume conversation history cannot silently starve document-slice or retrieval-hit.
  maxTotalCharacters: 20_000,
  maxTotalBlocks: 34,
  categories: {
    summary: { maxCharacters: 3_000, maxBlocks: 1 },
    'room-delta': { maxCharacters: 4_000, maxBlocks: 12 },
    'reply-chain': { maxCharacters: 3_000, maxBlocks: 8 },
    'document-slice': { maxCharacters: 3_500, maxBlocks: 6 },
    'retrieval-hit': { maxCharacters: 2_500, maxBlocks: 6 },
    'current-message': { maxCharacters: 4_000, maxBlocks: 1 },
  },
};

export type RoomContextBudgetSummaryV1 = {
  categoryBlocksSum: number;
  categoryCharactersSum: number;
  maxTotalBlocks: number;
  maxTotalCharacters: number;
  starvationFree: boolean;
};

export function summarizeRoomContextBudgetV1(
  budget: RoomContextBudgetConfigV1
): RoomContextBudgetSummaryV1 {
  let categoryCharactersSum = 0;
  let categoryBlocksSum = 0;
  for (const category of ROOM_CONTEXT_CATEGORIES_V1) {
    categoryCharactersSum += budget.categories[category].maxCharacters;
    categoryBlocksSum += budget.categories[category].maxBlocks;
  }
  return {
    categoryBlocksSum,
    categoryCharactersSum,
    maxTotalBlocks: budget.maxTotalBlocks,
    maxTotalCharacters: budget.maxTotalCharacters,
    starvationFree:
      categoryCharactersSum <= budget.maxTotalCharacters &&
      categoryBlocksSum <= budget.maxTotalBlocks,
  };
}

export function isRoomContextBudgetStarvationFreeV1(
  budget: RoomContextBudgetConfigV1
): boolean {
  return summarizeRoomContextBudgetV1(budget).starvationFree;
}

export class RoomContextBudgetErrorV1 extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomContextBudgetErrorV1';
  }
}
function assertNonNegativeInteger(value: number, path: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RoomContextBudgetErrorV1(
      `${path} must be a non-negative safe integer.`
    );
  }
}

export function validateRoomContextBudgetV1(
  budget: RoomContextBudgetConfigV1
): RoomContextBudgetConfigV1 {
  if (budget.schemaVersion !== ROOM_CONTEXT_CONTRACT_VERSION_V1) {
    throw new RoomContextBudgetErrorV1(
      'Room context budget schemaVersion must be 1.'
    );
  }
  if (!budget.configVersion.trim() || !budget.summaryConfigVersion.trim()) {
    throw new RoomContextBudgetErrorV1(
      'Room context budget versions must be non-empty.'
    );
  }
  assertNonNegativeInteger(
    budget.maxTotalCharacters,
    'budget.maxTotalCharacters'
  );
  assertNonNegativeInteger(budget.maxTotalBlocks, 'budget.maxTotalBlocks');

  for (const category of ROOM_CONTEXT_CATEGORIES_V1) {
    const categoryBudget = budget.categories[category];
    if (!categoryBudget) {
      throw new RoomContextBudgetErrorV1(
        `budget.categories.${category} is required.`
      );
    }
    assertNonNegativeInteger(
      categoryBudget.maxCharacters,
      `budget.categories.${category}.maxCharacters`
    );
    assertNonNegativeInteger(
      categoryBudget.maxBlocks,
      `budget.categories.${category}.maxBlocks`
    );
  }

  if (
    budget.maxTotalBlocks < 1 ||
    budget.maxTotalCharacters < 1 ||
    budget.categories['current-message'].maxBlocks < 1 ||
    budget.categories['current-message'].maxCharacters < 1
  ) {
    throw new RoomContextBudgetErrorV1(
      'Room context budgets must reserve a block and character for the current message.'
    );
  }

  return budget;
}

export function createRoomContextBudgetUsageV1(
  budget: RoomContextBudgetConfigV1
): RoomContextBudgetUsageV1 {
  const categories = Object.fromEntries(
    ROOM_CONTEXT_CATEGORIES_V1.map((category) => [
      category,
      {
        ...budget.categories[category],
        consideredBlocks: 0,
        includedBlocks: 0,
        excludedBlocks: 0,
        truncatedBlocks: 0,
        usedCharacters: 0,
      } satisfies RoomContextCategoryBudgetUsageV1,
    ])
  ) as Record<RoomContextCategoryV1, RoomContextCategoryBudgetUsageV1>;

  return {
    schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
    unit: 'utf16-code-unit',
    maxTotalCharacters: budget.maxTotalCharacters,
    maxTotalBlocks: budget.maxTotalBlocks,
    usedCharacters: 0,
    includedBlocks: 0,
    categories,
  };
}
