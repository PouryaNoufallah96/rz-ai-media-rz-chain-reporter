import type { DraftEditorInput, PlatformDraftCard } from "../schemas/drafts";

const EMPTY_EDITOR: DraftEditorInput = {
  contentLocale: "en",
  headline: "",
  body: "",
  hashtags: [],
};

export type EditBaseline = {
  id: string;
  revisionVersion: number;
  content: DraftEditorInput;
};

export type RevisionEditorState = {
  card: PlatformDraftCard | null;
  baseline: EditBaseline | null;
  editorValues: DraftEditorInput;
  hashtagDraft: string;
  loadVersion: number;
};

export function revisionValues(
  revision: PlatformDraftCard["revisions"][number],
): DraftEditorInput {
  return {
    contentLocale: revision.contentLocale,
    headline: revision.headline,
    body: revision.body,
    hashtags: [...revision.hashtags],
  };
}

export function revisionEditorState(
  card: PlatformDraftCard | null,
): RevisionEditorState {
  const active = card?.revisions.find(
    (revision) => revision.id === card.activeRevisionId,
  );
  const editorValues = active ? revisionValues(active) : EMPTY_EDITOR;
  return {
    card,
    hashtagDraft: "",
    loadVersion: 0,
    baseline:
      active && card
        ? {
            id: active.id,
            revisionVersion: card.revisionVersion,
            content: editorValues,
          }
        : null,
    editorValues,
  };
}

export function acceptRevisionCard(
  current: RevisionEditorState,
  incoming: PlatformDraftCard | null,
  preserveEdits: boolean,
): RevisionEditorState {
  const previous = current.card;
  if (
    !incoming ||
    (previous &&
      (incoming.id !== previous.id ||
        incoming.revisionVersion < previous.revisionVersion ||
        (incoming.revisionVersion === previous.revisionVersion &&
          incoming.activeRevisionId !== previous.activeRevisionId)))
  ) {
    return current;
  }
  return preserveEdits
    ? { ...current, card: incoming }
    : {
        ...revisionEditorState(incoming),
        loadVersion: current.loadVersion + 1,
      };
}
