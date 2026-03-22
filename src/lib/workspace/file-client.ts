'use client';

import { apiCallOrThrow } from '@/framework/resilience';

export async function saveWorkspaceFileContent(params: {
  content: string;
  fileId: string;
  workspaceId: string;
}) {
  await apiCallOrThrow<null>(`/api/workspaces/${params.workspaceId}/files/${params.fileId}`, {
    body: JSON.stringify({
      content: params.content,
    }),
    fallbackMessage: 'Could not save the file.',
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
    parseAs: 'void',
  });
}
