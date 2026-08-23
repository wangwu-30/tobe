export function resolveDefaultRoomKey(projectId?: string | null) {
  return projectId ? `project:${projectId}:default` : 'default';
}
