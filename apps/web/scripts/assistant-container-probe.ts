import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const webRoot = process.cwd();
const source = (path: string) => readFileSync(resolve(webRoot, path), "utf8");
const occurrences = (value: string, pattern: RegExp) =>
  value.match(pattern)?.length ?? 0;

const layout = source("src/app/[locale]/(app)/layout.tsx");
const page = source("src/app/[locale]/(app)/assistant/page.tsx");
const widget = source("src/features/assistant/components/assistant-widget.tsx");
const controller = source(
  "src/features/assistant/components/assistant-controller.tsx",
);
const host = source(
  "src/features/assistant/components/assistant-page-host.tsx",
);
const assistantContext = source(
  "src/features/assistant/lib/assistant-context.tsx",
);
const cardSheet = source("src/features/editorial/components/card-sheet.tsx");
const editorialCoordinator = source(
  "src/features/editorial/components/editorial-coordinator.tsx",
);
const respond = source("src/app/api/chat/respond.ts");

assert.equal(
  occurrences(layout, /<AssistantSlot\b/gu),
  1,
  "the app layout must mount one assistant slot",
);
assert.equal(
  occurrences(widget, /<AssistantController\b/gu),
  1,
  "the widget must mount one controller",
);
assert.equal(
  occurrences(controller, /useChat</gu),
  1,
  "the controller must own one useChat instance",
);
assert.equal(
  occurrences(controller, /<AssistantBody\b/gu),
  1,
  "the controller must render one assistant body",
);
assert.equal(
  occurrences(controller, /createPortal\(/gu),
  2,
  "the controller must own one stable body portal and one floating chrome portal",
);
assert.match(
  controller,
  /const bodyPortal = bodyRoot[\s\S]*createPortal\([\s\S]*<AssistantBody[\s\S]*bodyRoot/u,
  "the sole assistant body must render through the stable body portal",
);
assert.match(
  controller,
  /const destination = activePageHost \?\? \(open \? floatingHost : null\)/u,
  "the same portal root must select the registered page or floating host",
);
assert.match(
  host,
  /bodyRoot\.dataset\.assistantBodyRoot = ""/u,
  "the stable body root must expose the browser invariant marker",
);
assert.match(
  host,
  /data-assistant-page-host/u,
  "the passive page host must expose the browser invariant marker",
);
assert.doesNotMatch(
  host,
  /useChat|<AssistantBody\b|<AssistantController\b/u,
  "the passive page host must not create another assistant runtime",
);
assert.equal(
  occurrences(page, /<AssistantPageHost\b/gu),
  1,
  "the page route must render one passive host",
);
assert.doesNotMatch(
  page,
  /useChat|<AssistantBody\b|<AssistantController\b/u,
  "the page route must not create another assistant runtime",
);
assert.match(
  controller,
  /card: sheetCardRef\.current \?\? card/u,
  "every send must prefer the live open-sheet card",
);
assert.match(
  controller,
  /lastPathname\.current = pathname;[\s\S]*clearCard\(\)/u,
  "a pathname change must clear both attachment owners",
);
assert.match(
  assistantContext,
  /const pinCard = \(next: AssistantActiveCard\)[\s\S]*setCard\(bounded\)/u,
  "opening a board card must pin its bounded active revision",
);
assert.match(
  assistantContext,
  /const clearCard = \(\)[\s\S]*setCard\(null\)[\s\S]*sheetCardRef\.current = null/u,
  "attachment dismissal must clear both the pin and live sheet ref",
);
assert.match(
  editorialCoordinator,
  /onOpenCard=\{\(card, trigger\)[\s\S]*pinCard\(\{[\s\S]*draftId: card\.id,[\s\S]*platform: card\.platform/u,
  "the Editorial board must pin the opened draft's active content",
);
assert.match(
  cardSheet,
  /const current = form\.getValues\(\);[\s\S]*publishSheetCard\(\{[\s\S]*copy: current\.body,[\s\S]*headline: current\.headline/u,
  "live unsaved form values must publish to the send-time ref",
);
assert.match(
  cardSheet,
  /useLayoutEffect\(\(\) => \{[\s\S]*editor\.loadVersion[\s\S]*form\.reset[\s\S]*publishSheetCard/u,
  "each loaded revision must refresh the open-sheet attachment",
);
assert.match(
  cardSheet,
  /const dismiss = \(\) => \{[\s\S]*publishSheetCard\(null\)[\s\S]*assistant\.clearCard\(\)[\s\S]*onOpenChange\(false\)/u,
  "closing the sheet must clear both attachment owners",
);
assert.match(cardSheet, /<Sheet[\s\S]*modal=\{false\}/u);
assert.match(cardSheet, /child\.inert = true/u);
assert.match(
  respond,
  /readLiveDraftOrigin\([\s\S]*executor,[\s\S]*workspaceId,[\s\S]*userId,[\s\S]*claimed\.draftId,[\s\S]*\)/u,
  "active-card authorization must load the actor-owned draft origin",
);
assert.match(
  respond,
  /origin\.platform === claimed\.platform[\s\S]*request\.brandKeys\.includes\(origin\.brandKey\)/u,
  "active-card authorization must retain canonical platform and brand checks",
);
assert.doesNotMatch(
  respond,
  /origin\.contentLocale === claimed\.contentLocale/u,
  "live unsaved locale must not be rejected by active-revision locale",
);

process.stdout.write(
  `${JSON.stringify({
    bodyPortals: 1,
    bodies: 1,
    controllers: 1,
    layoutSlots: 1,
    pageHosts: 1,
    useChatInstances: 1,
  })}\nPASS assistant container composition\n`,
);
