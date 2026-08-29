import {
  type DraftEditorInput,
  draftEditorSchema,
  type PlatformDraftCard,
} from "../schemas/drafts";

export type EditSource = {
  kind: "copy_variant" | "draft_revision";
  id: string;
  revisionNumber: number | null;
  content: DraftEditorInput;
};

export type RevisionEditorState = {
  card: PlatformDraftCard | null;
  source: EditSource | null;
  editorValues: DraftEditorInput;
  hashtagDraft: string;
  loadVersion: number;
};

function cloneValues(values: DraftEditorInput): DraftEditorInput {
  return {
    contentLocale: values.contentLocale,
    headline: values.headline,
    body: values.body,
    hashtags: [...values.hashtags],
  };
}

function hasEditedFields(
  source: EditSource | null,
  values: DraftEditorInput,
  hashtagDraft: string,
  includeLocale: boolean,
) {
  if (!source) return false;
  if (hashtagDraft.trim() !== "") return true;
  const parsed = draftEditorSchema.safeParse(values);
  const parsedSource = draftEditorSchema.safeParse(source.content);
  if (!parsed.success || !parsedSource.success) return true;
  return (
    (includeLocale &&
      parsed.data.contentLocale !== parsedSource.data.contentLocale) ||
    parsed.data.headline !== parsedSource.data.headline ||
    parsed.data.body !== parsedSource.data.body ||
    parsed.data.hashtags.length !== parsedSource.data.hashtags.length ||
    parsed.data.hashtags.some(
      (hashtag, index) => hashtag !== parsedSource.data.hashtags[index],
    )
  );
}

export function hasRevisionEdits(
  source: EditSource | null,
  values: DraftEditorInput,
  hashtagDraft: string,
) {
  return hasEditedFields(source, values, hashtagDraft, true);
}

export function hasGenerationBlockingEdits(
  source: EditSource | null,
  values: DraftEditorInput,
  hashtagDraft: string,
) {
  return hasEditedFields(source, values, hashtagDraft, false);
}

export function canCreateRevision(source: EditSource | null, dirty: boolean) {
  return source?.kind === "copy_variant" || (source !== null && dirty);
}

export function canChangeSavedCard(
  source: EditSource | null,
  dirty: boolean,
  stale: boolean,
) {
  return source?.kind === "draft_revision" && !dirty && !stale;
}

export function candidateValues(
  candidate: PlatformDraftCard["candidates"][number],
): DraftEditorInput {
  return cloneValues(candidate);
}

export function revisionValues(
  revision: PlatformDraftCard["revisions"][number],
): DraftEditorInput {
  return cloneValues(revision);
}

export function candidateEditSource(
  candidate: PlatformDraftCard["candidates"][number],
): EditSource {
  return {
    kind: "copy_variant",
    id: candidate.id,
    revisionNumber: null,
    content: candidateValues(candidate),
  };
}

export function revisionEditSource(
  revision: PlatformDraftCard["revisions"][number],
): EditSource {
  return {
    kind: "draft_revision",
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    content: revisionValues(revision),
  };
}

function defaultSource(card: PlatformDraftCard | null) {
  const active = card?.revisions.find(
    (revision) => revision.id === card.activeRevisionId,
  );
  if (active) return revisionEditSource(active);
  const candidate = card?.candidates[0];
  return candidate ? candidateEditSource(candidate) : null;
}

export function revisionEditorState(
  card: PlatformDraftCard | null,
): RevisionEditorState {
  const source = defaultSource(card);
  const emptyEditor: DraftEditorInput = {
    contentLocale:
      card?.generation?.requestedContentLocale ??
      card?.originDetails?.contentLocale ??
      "en",
    headline: "",
    body: "",
    hashtags: [],
  };
  return {
    card,
    source,
    hashtagDraft: "",
    loadVersion: 0,
    editorValues: source ? cloneValues(source.content) : emptyEditor,
  };
}

export function selectEditSource(
  current: RevisionEditorState,
  source: EditSource,
): RevisionEditorState {
  const selected = { ...source, content: cloneValues(source.content) };
  return {
    ...current,
    source: selected,
    editorValues: cloneValues(selected.content),
    hashtagDraft: "",
    loadVersion: current.loadVersion + 1,
  };
}

export function acceptRevisionCard(
  current: RevisionEditorState,
  incoming: PlatformDraftCard | null,
  preserveSource: boolean,
): RevisionEditorState {
  const previous = current.card;
  if (previous && incoming && incoming.id !== previous.id) {
    return {
      ...revisionEditorState(incoming),
      loadVersion: current.loadVersion + 1,
    };
  }
  if (
    !incoming ||
    (previous &&
      (incoming.revisionVersion < previous.revisionVersion ||
        (incoming.revisionVersion === previous.revisionVersion &&
          incoming.activeRevisionId !== previous.activeRevisionId) ||
        incoming.projectionVersion < previous.projectionVersion))
  ) {
    return current;
  }
  const sourceStillExists =
    current.source?.kind === "draft_revision"
      ? incoming.revisions.some(
          (revision) => revision.id === current.source?.id,
        )
      : incoming.candidates.some(
          (candidate) => candidate.id === current.source?.id,
        );
  return preserveSource && current.source && sourceStillExists
    ? { ...current, card: incoming }
    : {
        ...revisionEditorState(incoming),
        loadVersion: current.loadVersion + 1,
      };
}
