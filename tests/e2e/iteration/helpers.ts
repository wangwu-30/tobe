import fs from 'node:fs';
import path from 'node:path';
import type { FullConfig, Page } from '@playwright/test';
import type { CommentAgentConfigData } from '@/types';

export const LOCAL_PLATFORM_HEADERS = {
  'content-type': 'application/json',
  'x-dao-device-id': 'local-device',
  'x-dao-organization-id': 'local-org',
  'x-dao-user-id': 'local-user',
} as const;

export type SeedWorkspace = {
  ancestorInheritedThreadId?: string;
  conversationId: string;
  fileId: string;
  id: string;
  secondVersionId?: string;
  siblingBranchThreadId?: string;
  supportFileId?: string;
  versionId?: string;
};

export type SeedState = {
  baseWorkspace: SeedWorkspace;
  blockDiscussionWorkspace: SeedWorkspace & {
    crossBlockThreadId: string;
  };
  branchSupportWorkspace: SeedWorkspace & {
    branchConversationId: string;
    branchTitle: string;
  };
  branchVersionWorkspace: SeedWorkspace & {
    branchMessageId: string;
  };
  commentsApplyWorkspace: SeedWorkspace & {
    applyThreadId: string;
    replacementText: string;
  };
  commentsBlockedWorkspace: SeedWorkspace & {
    blockedThreadId: string;
  };
  commentsAgentWorkspace: SeedWorkspace & {
    manualThreadId: string;
    waitingThreadId: string;
  };
  intentSwitchWorkspace: SeedWorkspace;
  agentMissingWorkspace: SeedWorkspace & {
    blockedAgentThreadId: string;
  };
  mentionTestWorkspace: SeedWorkspace;
  researchWorkspace: SeedWorkspace & {
    blockedRunId: string;
    commentResearchBlockedThreadId: string;
    commentResearchCompletedThreadId: string;
    commentResearchProposalThreadId: string;
    reportFileId: string;
  };
  supportWorkspace: SeedWorkspace;
};

export function buildHeading(text: string, level: 1 | 2 | 3 = 1) {
  return {
    type: `h${level}`,
    children: [{ text }],
  };
}

export function buildParagraph(text: string) {
  return {
    type: 'p',
    children: [{ text }],
  };
}

export function readSeedState() {
  const seedStatePath = resolveSeedStatePath();
  return JSON.parse(fs.readFileSync(seedStatePath, 'utf8')) as SeedState;
}

export function resolveBaseURL(config?: FullConfig) {
  if (config?.projects[0]?.use?.baseURL && typeof config.projects[0].use.baseURL === 'string') {
    return config.projects[0].use.baseURL;
  }

  return process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:3216';
}

export function resolveIterationProjectsRoot() {
  return (
    process.env.ITERATION_PROJECTS_ROOT ||
    path.join(process.cwd(), '.tmp', 'iteration-regression', 'projects')
  );
}

export function resolveSeedStatePath() {
  return (
    process.env.ITERATION_SEED_STATE_PATH ||
    path.join(process.cwd(), '.tmp', 'iteration-regression', 'seed-state.json')
  );
}

export async function apiRequest<T>(
  baseURL: string,
  pathname: string,
  init?: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  }
) {
  const response = await fetch(new URL(pathname, baseURL), {
    body:
      init?.body === undefined
        ? undefined
        : JSON.stringify(init.body),
    headers: {
      ...LOCAL_PLATFORM_HEADERS,
      ...init?.headers,
    },
    method: init?.method || 'GET',
  });
  const text = await response.text();

  if (!response.ok) {
    const responseExcerpt = text.slice(0, 1_000);
    throw new Error(
      `API ${init?.method || 'GET'} ${pathname} failed with ${response.status}: ${responseExcerpt}`
    );
  }

  if (!text) {
    return null as T;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `API ${init?.method || 'GET'} ${pathname} returned non-JSON content (${response.headers.get('content-type') || 'unknown'}): ${text.slice(0, 1_000)}`
    );
  }

  return payload as T;
}

export function createDocumentSelectionAnchor(params: {
  end?: { offset: number; path: number[] };
  excerpt: string;
  fileId: string;
  rangeState: 'single-block' | 'cross-block';
  start?: { offset: number; path: number[] };
}) {
  return JSON.stringify({
    surfaceType: 'document-selection',
    bindingType: 'selection',
    anchorPayload: {
      excerpt: params.excerpt,
      rangeState: params.rangeState,
      ...(params.start && params.end
        ? {
            start: params.start,
            end: params.end,
          }
        : {}),
    },
    previewVersionId: null,
    sourceMapping: {
      fileId: params.fileId,
    },
  });
}

export function extractWorkspaceIdFromLocation(urlPath: string) {
  const url = new URL(urlPath, 'http://127.0.0.1');
  const pathMatch = url.pathname.match(/\/workspace\/([^/?]+)/);
  return url.searchParams.get('node') || pathMatch?.[1] || null;
}

export async function primeClientState(
  page: Page,
  options?: {
    commentAgents?: CommentAgentConfigData[];
  }
) {
  await page.addInitScript((payload) => {
    const aiSettings = {
      language: 'zh-CN',
      ...(payload.commentAgents.length > 0
        ? { commentAgents: payload.commentAgents }
        : {}),
    };

    if (!window.localStorage.getItem('ai-settings')) {
      window.localStorage.setItem('ai-settings', JSON.stringify(aiSettings));
    }
  }, {
    commentAgents: options?.commentAgents || [],
  });
}

export async function waitForWorkspaceRoute(
  page: Page,
  options?: {
    excludeConversationId?: string;
    excludeWorkspaceId?: string;
    timeout?: number;
  }
) {
  await page.waitForFunction(
    (payload) => {
      const url = new URL(window.location.href);
      const match = url.pathname.match(/^\/workspace\/([^/]+)$/);
      const conversationId = url.searchParams.get('conversationId') || '';
      const workspaceId = url.searchParams.get('node') || match?.[1] || '';
      const currentTreeNode = workspaceId
        ? document.querySelector(`[data-testid="sidebar-project-tree-current-${workspaceId}"]`)
        : null;

      if (!match || !conversationId || !workspaceId) {
        return false;
      }

      if (payload.excludeWorkspaceId && workspaceId === payload.excludeWorkspaceId) {
        return false;
      }

      if (payload.excludeConversationId && conversationId === payload.excludeConversationId) {
        return false;
      }

      return Boolean(currentTreeNode);
    },
    {
      excludeConversationId: options?.excludeConversationId || '',
      excludeWorkspaceId: options?.excludeWorkspaceId || '',
    },
    { timeout: options?.timeout ?? 10000 }
  );

  const currentUrl = new URL(page.url());
  const match = currentUrl.pathname.match(/^\/workspace\/([^/]+)$/);
  const projectId = match?.[1] || '';
  const workspaceId = currentUrl.searchParams.get('node') || projectId;
  const conversationId = currentUrl.searchParams.get('conversationId') || '';

  if (!projectId || !workspaceId || !conversationId) {
    throw new Error(`Expected workspace route, received ${page.url()}`);
  }

  return {
    conversationId,
    pathname: currentUrl.pathname,
    projectId,
    workspaceId,
  };
}
