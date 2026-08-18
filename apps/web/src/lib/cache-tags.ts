import "server-only";

export type WorkspaceEntity = "installation";

export function workspaceTag(workspaceId: string, entity: WorkspaceEntity) {
  return `workspace:${workspaceId}:${entity}` as const;
}
