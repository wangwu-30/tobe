'use client';

export async function saveWorkspaceFileContent(params: {
  content: string;
  fileId: string;
  workspaceId: string;
}) {
  await fetch(`/api/workspaces/${params.workspaceId}/files/${params.fileId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: params.content,
    }),
  });
}
