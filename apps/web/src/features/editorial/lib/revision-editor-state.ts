import {
  type DraftEditorInput,
  draftEditorSchema,
  type PlatformDraftCard,
  type PlatformDraftExactCard,
} from "../schemas/drafts";

export type RevisionDraftCard = PlatformDraftCard | PlatformDraftExactCard;

export type EditSource = {
  kind: "copy_variant" | "draft_revision";
  id: string;
  revisionNumber: number | null;
  content: DraftEditorInput;
};

export type RevisionEditorState = {
  card: RevisionDraftCard | null;
  freshContentLocale: DraftEditorInput["contentLocale"];
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
  return !sameEditorValues(source.content, values, includeLocale);
}

function sameEditorValues(
  first: DraftEditorInput,
  second: DraftEditorInput,
  includeLocale = true,
) {
  const parsedFirst = draftEditorSchema.safeParse(first);
  const parsedSecond = draftEditorSchema.safeParse(second);
  if (!parsedFirst.success || !parsedSecond.success) return false;
  return (
    (!includeLocale ||
      parsedFirst.data.contentLocale === parsedSecond.data.contentLocale) &&
    parsedFirst.data.headline === parsedSecond.data.headline &&
    parsedFirst.data.body === parsedSecond.data.body &&
    parsedFirst.data.hashtags.length === parsedSecond.data.hashtags.length &&
    parsedFirst.data.hashtags.every(
      (hashtag, index) => hashtag === parsedSecond.data.hashtags[index],
    )
  );
}

export function sameEditSource(first: EditSource | null, second: EditSource) {
  return (
    first?.kind === second.kind &&
    first.id === second.id &&
    sameEditorValues(first.content, second.content)
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
  candidate: RevisionDraftCard["candidates"][number],
): DraftEditorInput {
  return cloneValues(candidate);
}

export function revisionValues(
  revision: RevisionDraftCard["revisions"][number],
): DraftEditorInput {
  return cloneValues(revision);
}

export function candidateEditSource(
  candidate: RevisionDraftCard["candidates"][number],
): EditSource {
  return {
    kind: "copy_variant",
    id: candidate.id,
    revisionNumber: null,
    content: candidateValues(candidate),
  };
}

export function revisionEditSource(
  revision: RevisionDraftCard["revisions"][number],
): EditSource {
  return {
    kind: "draft_revision",
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    content: revisionValues(revision),
  };
}

function defaultSource(card: RevisionDraftCard | null) {
  const active = card?.revisions.find(
    (revision) => revision.id === card.activeRevisionId,
  );
  if (active) return revisionEditSource(active);
  const candidate = card?.candidates[0];
  return candidate ? candidateEditSource(candidate) : null;
}

function currentSource(card: RevisionDraftCard, source: EditSource) {
  if (source.kind === "draft_revision") {
    const revision = card.revisions.find((entry) => entry.id === source.id);
    return revision ? revisionEditSource(revision) : null;
  }
  const candidate = card.candidates.find((entry) => entry.id === source.id);
  return candidate ? candidateEditSource(candidate) : null;
}

export function initialContentLocale(
  card: RevisionDraftCard | null,
  freshContentLocale: DraftEditorInput["contentLocale"],
) {
  return (
    defaultSource(card)?.content.contentLocale ??
    card?.generation?.requestedContentLocale ??
    freshContentLocale
  );
}

export function revisionEditorState(
  card: RevisionDraftCard | null,
  freshContentLocale: DraftEditorInput["contentLocale"],
): RevisionEditorState {
  const source = defaultSource(card);
  const emptyEditor: DraftEditorInput = {
    contentLocale: initialContentLocale(card, freshContentLocale),
    headline: "",
    body: "",
    hashtags: [],
  };
  return {
    card,
    freshContentLocale,
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
  incoming: RevisionDraftCard | null,
  preserveSource: boolean,
): RevisionEditorState {
  const previous = current.card;
  if (previous && incoming && incoming.id !== previous.id) {
    return {
      ...revisionEditorState(incoming, current.freshContentLocale),
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
  const incomingSource = current.source
    ? currentSource(incoming, current.source)
    : null;
  if (
    preserveSource &&
    current.source &&
    !incomingSource &&
    hasRevisionEdits(current.source, current.editorValues, current.hashtagDraft)
  ) {
    return { ...current, card: incoming };
  }
  if (preserveSource && current.source && incomingSource) {
    const pristine = !hasRevisionEdits(
      current.source,
      current.editorValues,
      current.hashtagDraft,
    );
    if (
      pristine &&
      current.source.kind === "copy_variant" &&
      !sameEditSource(current.source, incomingSource)
    ) {
      return selectEditSource({ ...current, card: incoming }, incomingSource);
    }
    return { ...current, card: incoming };
  }
  return {
    ...revisionEditorState(incoming, current.freshContentLocale),
    loadVersion: current.loadVersion + 1,
  };
}
