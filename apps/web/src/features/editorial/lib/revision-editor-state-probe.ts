import assert from "node:assert/strict";

import { draftEditorSchema, type PlatformDraftCard } from "../schemas/drafts";
import {
  acceptRevisionCard,
  revisionEditorState,
  revisionValues,
} from "./revision-editor-state";

const first: PlatformDraftCard["revisions"][number] = {
  id: "revision-1",
  revisionNumber: 1,
  contentLocale: "en",
  headline: "First headline",
  body: "First body",
  hashtags: ["#Brand", "#First"],
  originatingCopyVariantId: "candidate-1",
  selectedFinalMediaAssetId: null,
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
  origin: { kind: "promo_idea", promoIdeaId: "idea" },
  originTitle: "Origin",
  sourceKind: "promo",
  originDetails: null,
  generation: null,
  candidates: [],
  revisions: [],
  imageGeneration: null,
  imageModels: [],
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
  revisions: [first],
};
const appliedSecond: PlatformDraftCard = {
  ...appliedFirst,
  activeRevisionId: second.id,
  revisionVersion: 2,
  revisions: [second, first],
};

const editableSecond = revisionValues(second);
editableSecond.hashtags.reverse();
assert.deepEqual(second.hashtags, ["#Brand", "#Second", "#First"]);

let state = acceptRevisionCard(revisionEditorState(empty), appliedFirst, false);
assert.equal(state.baseline?.id, first.id);
assert.equal(state.editorValues.body, first.body);
state = acceptRevisionCard(state, empty, false);
assert.equal(state.card?.activeRevisionId, first.id);
assert.equal(state.baseline?.id, first.id);

state = acceptRevisionCard(state, appliedSecond, false);
const acceptedSecond = state;
state = acceptRevisionCard(state, appliedFirst, true);
assert.equal(state.card, appliedSecond);
assert.equal(state.editorValues, acceptedSecond.editorValues);
assert.deepEqual(state.editorValues.hashtags, second.hashtags);
assert.equal(state.editorValues.contentLocale, second.contentLocale);

const selectedFirst = {
  ...appliedSecond,
  activeRevisionId: first.id,
  revisionVersion: 3,
};
const preserved = acceptRevisionCard(state, selectedFirst, true);
assert.equal(preserved.card, selectedFirst);
assert.equal(preserved.baseline?.id, second.id);
assert.equal(preserved.baseline?.revisionVersion, 2);
assert.equal(preserved.editorValues, state.editorValues);

state = acceptRevisionCard(preserved, selectedFirst, false);
assert.equal(state.baseline?.id, first.id);
assert.equal(state.baseline?.revisionVersion, 3);
assert.equal(state.editorValues.body, first.body);
assert.equal(state.card?.revisions[0]?.id, second.id);

state = acceptRevisionCard(state, appliedSecond, false);
assert.equal(state.card, selectedFirst);
assert.equal(state.baseline?.id, first.id);
assert.equal(state.editorValues.body, first.body);
const merged = {
  ...state,
  editorValues: { ...state.editorValues, body: "Merged local body" },
  hashtagDraft: "pending-tag",
};
assert.equal(acceptRevisionCard(merged, appliedSecond, false), merged);
assert.equal(acceptRevisionCard(merged, null, false), merged);
const reloaded = acceptRevisionCard(merged, selectedFirst, false);
assert.equal(reloaded.editorValues.body, first.body);
assert.equal(reloaded.hashtagDraft, "");
assert.equal(reloaded.loadVersion, merged.loadVersion + 1);
assert.deepEqual(reloaded.editorValues, state.editorValues);
assert.equal(acceptRevisionCard(state, null, false).card, selectedFirst);
assert.equal(
  acceptRevisionCard(state, { ...appliedSecond, revisionVersion: 3 }, false)
    .card,
  selectedFirst,
);
assert.equal(
  acceptRevisionCard(
    state,
    { ...appliedSecond, id: "other", revisionVersion: 9 },
    false,
  ).card,
  selectedFirst,
);

const refreshed = {
  ...selectedFirst,
  imageModels: [{ key: "new", name: "New" }],
};
assert.equal(acceptRevisionCard(state, refreshed, true).card, refreshed);

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
  "PASS revision editor monotonic state, dirty preservation, and shared validation\n",
);
