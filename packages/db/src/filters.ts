import { and, eq, isNull } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

type WorkspaceScoped = { workspaceId: PgColumn };
type SoftDeletable = { deletedAt: PgColumn };

export function inWorkspace(table: WorkspaceScoped, workspaceId: string) {
  return eq(table.workspaceId, workspaceId);
}

export function notDeleted(table: SoftDeletable) {
  return isNull(table.deletedAt);
}

export function liveInWorkspace(
  table: WorkspaceScoped & SoftDeletable,
  workspaceId: string,
) {
  return and(inWorkspace(table, workspaceId), notDeleted(table));
}

const LIKE_METACHARACTERS = /[\\%_]/g;

export function containsPattern(value: string) {
  return `%${value.replace(LIKE_METACHARACTERS, (character) => `\\${character}`)}%`;
}
