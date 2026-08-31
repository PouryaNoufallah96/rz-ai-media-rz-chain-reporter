import assert from "node:assert/strict";
import {
  acceptRevisionCard,
  canChangeSavedCard,
  canCreateRevision,
  candidateEditSource,
  hasRevisionEdits,
  initialContentLocale,
  revisionEditorState,
  revisionEditSource,
  revisionValues,
  sameEditSource,
  selectEditSource,
} from "../src/features/editorial/lib/revision-editor-state";
import {
  draftEditorSchema,
  type PlatformDraftCard,
  updateDraftRevisionInputSchema,
} from "../src/features/editorial/schemas/drafts";

const localizedRevisionCommand = {
  commandKind: "select_revision" as const,
  draftRevisionId: "00000000-0000-4000-8000-000000000002",
  expectedActive: { id: null, version: 0 },
  idempotencyKey: "00000000-0000-4000-8000-000000000003",
  platformDraftId: "00000000-0000-4000-8000-000000000001",
  presentationLocale: "fa" as const,
};
assert.equal(
  updateDraftRevisionInputSchema.safeParse(localizedRevisionCommand).success,
  true,
);
const { presentationLocale: _presentationLocale, ...unlocalizedCommand } =
  localizedRevisionCommand;
assert.equal(
  updateDraftRevisionInputSchema.safeParse(unlocalizedCommand).success,
  false,
);
const localizedCopySourceCommand = {
  commandKind: "submit_content" as const,
  content: {
    body: "Body",
    contentLocale: "fa" as const,
    hashtags: ["#Brand"],
    headline: "Headline",
  },
  expectedActive: { id: null, version: 0 },
  idempotencyKey: "00000000-0000-4000-8000-000000000003",
  platformDraftId: "00000000-0000-4000-8000-000000000001",
  presentationLocale: "fa" as const,
  source: {
    kind: "copy_variant" as const,
    id: "00000000-0000-4000-8000-000000000004",
    contentLocale: "fa" as const,
  },
};
assert.equal(
  updateDraftRevisionInputSchema.safeParse(localizedCopySourceCommand).success,
  true,
);
const { contentLocale: _sourceLocale, ...unlocalizedCopySource } =
  localizedCopySourceCommand.source;
assert.equal(
  updateDraftRevisionInputSchema.safeParse({
    ...localizedCopySourceCommand,
    source: unlocalizedCopySource,
  }).success,
  false,
);

const first: PlatformDraftCard["revisions"][number] = {
  id: "revision-1",
  revisionNumber: 1,
  contentLocale: "en",
  headline: "First headline",
  body: "First body",
  hashtags: ["#Brand", "#First"],
  originatingCopyVariantId: "candidate-1",
  selectedFinalMediaAssetId: null,
  imageIntentVersion: 0,
  hasNonterminalImageGeneration: false,
  imageProvenanceMismatch: false,
  mediaLocked: false,
  authoredBy: "operator",
  authorName: "Operator",
  createdAt: new Date(0),
  imageSourceReadiness: "ready",
  sourceAttribution: null,
  sourceCanonicalUrl: null,
};
const second: typeof first = {
  ...first,
  id: "revision-2",
  revisionNumber: 2,
  contentLocale: "fa",
  headline: "Second headline",
  body: "Second body",
  hashtags: ["#Brand", "#Second", "#First"],
  originatingCopyVariantId: "candidate-2",
  selectedFinalMediaAssetId: "media-2",
};
const empty: PlatformDraftCard = {
  id: "draft",
  mediaBrandId: "brand",
  brandKey: "brand",
  brandName: "Brand",
  platform: "telegram",
  lanePosition: 1,
  version: 1,
  activeRevisionId: null,
  revisionVersion: 0,
  projectionVersion: 0,
  nextRevisionNumber: 1,
  presentationReady: true,
  presentationTranslation: null,
  origin: { kind: "promo_idea", promoIdeaId: "idea" },
  originTitle: "Origin",
  sourceKind: "promo",
  originDetails: null,
  generation: null,
  candidates: [],
  revisions: [],
  imageGeneration: null,
  publishing: {
    savedCard: null,
    approval: null,
    destinations: [],
    timeZone: "UTC",
    control: { paused: false, environmentForced: false, version: 0 },
    latestPublication: null,
    latestSchedule: null,
  },
};
const appliedFirst: PlatformDraftCard = {
  ...empty,
  activeRevisionId: first.id,
  revisionVersion: 1,
  nextRevisionNumber: 2,
  revisions: [first],
};
const appliedSecond: PlatformDraftCard = {
  ...appliedFirst,
  activeRevisionId: second.id,
  revisionVersion: 2,
  nextRevisionNumber: 3,
  revisions: [second, first],
};

const editableSecond = revisionValues(second);
editableSecond.hashtags.reverse();
assert.deepEqual(second.hashtags, ["#Brand", "#Second", "#First"]);

const freshPersian = revisionEditorState(null, "fa");
assert.equal(freshPersian.editorValues.contentLocale, "fa");
assert.equal(freshPersian.freshContentLocale, "fa");
assert.equal(
  acceptRevisionCard(freshPersian, empty, false).editorValues.contentLocale,
  "fa",
);

let state = acceptRevisionCard(
  revisionEditorState(empty, "en"),
  appliedFirst,
  false,
);
assert.equal(state.source?.id, first.id);
assert.equal(state.editorValues.body, first.body);
state = acceptRevisionCard(state, empty, false);
assert.equal(state.card?.activeRevisionId, first.id);
assert.equal(state.source?.id, first.id);

state = acceptRevisionCard(state, appliedSecond, false);
const acceptedSecond = state;
state = acceptRevisionCard(state, appliedFirst, true);
assert.equal(state.card, appliedSecond);
assert.equal(state.editorValues, acceptedSecond.editorValues);

const selectedFirst = {
  ...appliedSecond,
  activeRevisionId: first.id,
  revisionVersion: 3,
};
const preserved = acceptRevisionCard(state, selectedFirst, true);
assert.equal(preserved.card, selectedFirst);
assert.equal(preserved.source?.id, second.id);
assert.equal(preserved.editorValues, state.editorValues);

state = acceptRevisionCard(preserved, selectedFirst, false);
assert.equal(state.source?.id, first.id);
assert.equal(state.editorValues.body, first.body);

const projected = { ...selectedFirst, projectionVersion: 2 };
state = acceptRevisionCard(state, projected, false);
const staleProjection = { ...projected, projectionVersion: 1 };
assert.equal(acceptRevisionCard(state, staleProjection, false).card, projected);

const selectedSecond = selectEditSource(state, revisionEditSource(second));
assert.equal(selectedSecond.source?.id, second.id);
assert.equal(selectedSecond.source?.kind, "draft_revision");
selectedSecond.editorValues.hashtags.reverse();
assert.deepEqual(second.hashtags, ["#Brand", "#Second", "#First"]);
assert.equal(
  hasRevisionEdits(selectedSecond.source, selectedSecond.editorValues, ""),
  true,
);
const cleanSecond = selectEditSource(state, revisionEditSource(second));
assert.equal(
  hasRevisionEdits(cleanSecond.source, cleanSecond.editorValues, ""),
  false,
);
assert.equal(canCreateRevision(selectedSecond.source, false), false);
assert.equal(canCreateRevision(selectedSecond.source, true), true);
assert.equal(canChangeSavedCard(selectedSecond.source, false, false), true);
assert.equal(canChangeSavedCard(selectedSecond.source, true, false), false);
assert.equal(canChangeSavedCard(selectedSecond.source, false, true), false);
assert.equal(
  hasRevisionEdits(
    cleanSecond.source,
    {
      ...cleanSecond.editorValues,
      headline: ` ${cleanSecond.editorValues.headline} `,
      body: `\n${cleanSecond.editorValues.body}\n`,
      hashtags: cleanSecond.editorValues.hashtags.map((tag) => ` ${tag} `),
    },
    "",
  ),
  false,
);

const candidate: PlatformDraftCard["candidates"][number] = {
  id: "candidate-3",
  operationId: "operation-3",
  variantKey: "to_the_point",
  contentLocale: "en",
  headline: "Candidate headline",
  body: "Candidate body",
  hashtags: ["#Brand", "#Candidate"],
  limited: false,
  modelOptionKey: "model",
  createdAt: new Date(0),
  translation: null,
};
const selectedCandidate = selectEditSource(
  selectedSecond,
  candidateEditSource(candidate),
);
assert.equal(selectedCandidate.source?.kind, "copy_variant");
assert.equal(selectedCandidate.editorValues.headline, candidate.headline);
selectedCandidate.editorValues.hashtags.reverse();
assert.deepEqual(candidate.hashtags, ["#Brand", "#Candidate"]);
assert.equal(canCreateRevision(selectedCandidate.source, false), true);
assert.equal(canChangeSavedCard(selectedCandidate.source, false, false), false);
const localizedCandidate: typeof candidate = {
  ...candidate,
  contentLocale: "fa",
  headline: "تیتر نامزد",
  body: "متن نامزد",
  hashtags: ["#برند", "#نامزد"],
};
assert.equal(
  sameEditSource(
    candidateEditSource(candidate),
    candidateEditSource(localizedCandidate),
  ),
  false,
);
assert.equal(
  hasRevisionEdits(null, revisionEditorState(empty, "en").editorValues, ""),
  false,
);

const candidateCard = { ...appliedSecond, candidates: [candidate] };
const candidateState = selectEditSource(
  revisionEditorState(candidateCard, "fa"),
  candidateEditSource(candidate),
);
const replacedCandidates = acceptRevisionCard(
  candidateState,
  { ...candidateCard, candidates: [] },
  true,
);
assert.equal(replacedCandidates.source?.id, second.id);
assert.equal(replacedCandidates.source?.kind, "draft_revision");

const localizedCandidateCard = {
  ...candidateCard,
  candidates: [localizedCandidate],
  projectionVersion: candidateCard.projectionVersion + 1,
};
const pristineLocalized = acceptRevisionCard(
  candidateState,
  localizedCandidateCard,
  true,
);
assert.equal(pristineLocalized.source?.id, candidate.id);
assert.equal(pristineLocalized.editorValues.contentLocale, "fa");
assert.equal(
  pristineLocalized.editorValues.headline,
  localizedCandidate.headline,
);

const dirtyCandidateState = selectEditSource(
  revisionEditorState(candidateCard, "fa"),
  candidateEditSource(candidate),
);
dirtyCandidateState.editorValues.headline = "Operator edit";
const preservedDirtyCandidate = acceptRevisionCard(
  dirtyCandidateState,
  localizedCandidateCard,
  true,
);
assert.equal(preservedDirtyCandidate.editorValues.headline, "Operator edit");
assert.equal(preservedDirtyCandidate.source?.content.contentLocale, "en");

const removedDirtyCandidate = acceptRevisionCard(
  dirtyCandidateState,
  {
    ...candidateCard,
    candidates: [],
    projectionVersion: candidateCard.projectionVersion + 1,
  },
  true,
);
assert.equal(removedDirtyCandidate.editorValues.headline, "Operator edit");
assert.equal(removedDirtyCandidate.source?.id, candidate.id);

const removedRevision = acceptRevisionCard(
  selectEditSource(candidateState, revisionEditSource(first)),
  { ...candidateCard, revisions: [second] },
  true,
);
assert.equal(removedRevision.source?.id, second.id);

const candidateFirst = {
  ...empty,
  generation: {
    operationId: "generation-candidate",
    lifecycle: "succeeded" as const,
    modelOptionKey: "model",
    requestedContentLocale: "fa" as const,
    limited: false,
    forceArticleRefresh: false,
    createdAt: new Date(0),
    units: [],
  },
  candidates: [candidate],
};
assert.equal(initialContentLocale(appliedSecond, "en"), "fa");
assert.equal(initialContentLocale(candidateFirst, "fa"), "en");
assert.equal(
  initialContentLocale({ ...candidateFirst, candidates: [] }, "en"),
  "fa",
);

assert.deepEqual(
  draftEditorSchema.parse({
    contentLocale: "en",
    headline: " Headline ",
    body: " Body ",
    hashtags: [" #Brand ", " #Second ", "#First"],
  }),
  {
    contentLocale: "en",
    headline: "Headline",
    body: "Body",
    hashtags: ["#Brand", "#Second", "#First"],
  },
);
const emptyHashtag = draftEditorSchema.safeParse({
  ...revisionValues(first),
  hashtags: ["#Brand", " "],
});
assert.equal(emptyHashtag.success, false);
assert.equal(emptyHashtag.error?.issues[0]?.message, "DRAFT_HASHTAG_REQUIRED");

process.stdout.write(
  "PASS revision editor required presentation locale, explicit localized copy source, fresh UI locale initialization, persisted artifact locale precedence, pristine localization refresh, dirty edit preservation, local source selection, immutable cloning, monotonic state, and shared validation\n",
);
