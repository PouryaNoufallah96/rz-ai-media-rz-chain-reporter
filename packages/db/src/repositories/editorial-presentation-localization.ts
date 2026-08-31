import type { ContentLocale } from "@rz-chain-reporter/contracts";
import { and, eq, or } from "drizzle-orm";

import type { Executor } from "../executor";
import { inWorkspace } from "../filters";
import { editorialPresentationLocalization } from "../schema/editorial-presentation-localization";

type LocalizationSubject =
  | { kind: "source_item_revision"; sourceItemRevisionId: string }
  | { kind: "editorial_selection"; editorialSelectionId: string }
  | { kind: "promo_idea"; promoIdeaId: string };

export type EditorialPresentationLocalizationKey = LocalizationSubject & {
  presentationLocale: ContentLocale;
};

type LocalizationWriteBase = {
  presentationLocale: ContentLocale;
  operationAttemptId: string;
};

export type PersistEditorialPresentationLocalizationInput =
  LocalizationWriteBase &
    (
      | {
          kind: "source_item_revision";
          sourceItemRevisionId: string;
          title: string;
          summary: string | null;
        }
      | {
          kind: "editorial_selection";
          editorialSelectionId: string;
          reasoning: string;
        }
      | {
          kind: "promo_idea";
          promoIdeaId: string;
          title: string;
          description: string;
          angle: string;
        }
    );

export async function readEditorialPresentationLocalizations(
  executor: Executor,
  workspaceId: string,
  keys: readonly EditorialPresentationLocalizationKey[],
) {
  if (keys.length === 0) return [];

  return executor
    .select()
    .from(editorialPresentationLocalization)
    .where(
      and(
        inWorkspace(editorialPresentationLocalization, workspaceId),
        or(...keys.map(localizationPredicate)),
      ),
    );
}

export async function persistEditorialPresentationLocalizations(
  executor: Executor,
  workspaceId: string,
  inputs: readonly PersistEditorialPresentationLocalizationInput[],
) {
  if (inputs.length === 0) return [];

  await executor
    .insert(editorialPresentationLocalization)
    .values(inputs.map((input) => localizationValues(workspaceId, input)))
    .onConflictDoNothing();

  const keys = inputs.map(toLocalizationKey);
  const rows = await readEditorialPresentationLocalizations(
    executor,
    workspaceId,
    keys,
  );
  const resolvedKeys = new Set(rows.map(localizationIdentity));

  if (keys.some((key) => !resolvedKeys.has(localizationIdentity(key)))) {
    throw new Error("presentation localization conflict returned no row");
  }

  return rows;
}

function localizationPredicate(key: EditorialPresentationLocalizationKey) {
  const locale = eq(
    editorialPresentationLocalization.presentationLocale,
    key.presentationLocale,
  );

  switch (key.kind) {
    case "source_item_revision":
      return and(
        locale,
        eq(
          editorialPresentationLocalization.sourceItemRevisionId,
          key.sourceItemRevisionId,
        ),
      );
    case "editorial_selection":
      return and(
        locale,
        eq(
          editorialPresentationLocalization.editorialSelectionId,
          key.editorialSelectionId,
        ),
      );
    case "promo_idea":
      return and(
        locale,
        eq(editorialPresentationLocalization.promoIdeaId, key.promoIdeaId),
      );
  }
}

function localizationValues(
  workspaceId: string,
  input: PersistEditorialPresentationLocalizationInput,
): typeof editorialPresentationLocalization.$inferInsert {
  const base = {
    workspaceId,
    operationAttemptId: input.operationAttemptId,
    presentationLocale: input.presentationLocale,
  };

  switch (input.kind) {
    case "source_item_revision":
      return {
        ...base,
        sourceItemRevisionId: input.sourceItemRevisionId,
        title: input.title,
        summary: input.summary,
      };
    case "editorial_selection":
      return {
        ...base,
        editorialSelectionId: input.editorialSelectionId,
        reasoning: input.reasoning,
      };
    case "promo_idea":
      return {
        ...base,
        promoIdeaId: input.promoIdeaId,
        title: input.title,
        description: input.description,
        angle: input.angle,
      };
  }
}

function toLocalizationKey(
  input: PersistEditorialPresentationLocalizationInput,
): EditorialPresentationLocalizationKey {
  switch (input.kind) {
    case "source_item_revision":
      return {
        kind: input.kind,
        sourceItemRevisionId: input.sourceItemRevisionId,
        presentationLocale: input.presentationLocale,
      };
    case "editorial_selection":
      return {
        kind: input.kind,
        editorialSelectionId: input.editorialSelectionId,
        presentationLocale: input.presentationLocale,
      };
    case "promo_idea":
      return {
        kind: input.kind,
        promoIdeaId: input.promoIdeaId,
        presentationLocale: input.presentationLocale,
      };
  }
}

function localizationIdentity(
  value:
    | EditorialPresentationLocalizationKey
    | typeof editorialPresentationLocalization.$inferSelect,
) {
  if ("kind" in value) {
    switch (value.kind) {
      case "source_item_revision":
        return `source_item_revision:${value.sourceItemRevisionId}:${value.presentationLocale}`;
      case "editorial_selection":
        return `editorial_selection:${value.editorialSelectionId}:${value.presentationLocale}`;
      case "promo_idea":
        return `promo_idea:${value.promoIdeaId}:${value.presentationLocale}`;
    }
  }

  if (value.sourceItemRevisionId) {
    return `source_item_revision:${value.sourceItemRevisionId}:${value.presentationLocale}`;
  }
  if (value.editorialSelectionId) {
    return `editorial_selection:${value.editorialSelectionId}:${value.presentationLocale}`;
  }
  if (value.promoIdeaId) {
    return `promo_idea:${value.promoIdeaId}:${value.presentationLocale}`;
  }
  throw new Error("presentation localization has no subject");
}
