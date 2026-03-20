'use client';

async function readProjectActionError(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => null);
  return payload?.error || fallbackMessage;
}

export async function renameWorkspaceProject(params: {
  errorMessage: string;
  projectId: string;
  title: string;
}) {
  const response = await fetch(`/api/projects/${params.projectId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: params.title }),
  });

  if (!response.ok) {
    throw new Error(await readProjectActionError(response, params.errorMessage));
  }

  return (await response.json().catch(() => null)) as {
    id: string;
    title: string;
  } | null;
}

export async function deleteWorkspaceProject(params: {
  errorMessage: string;
  projectId: string;
}) {
  const response = await fetch(`/api/projects/${params.projectId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await readProjectActionError(response, params.errorMessage));
  }
}
