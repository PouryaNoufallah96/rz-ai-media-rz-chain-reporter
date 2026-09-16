export const ASSISTANT_NAMESPACE = "assistant";
export const ASSISTANT_FAB_CLASS =
  "fixed inset-e-4 bottom-4 z-60 size-16 overflow-hidden rounded-full";

export const MAX_QUESTION_CHARS = 2_000;
export const MAX_REQUEST_BYTES = 32 * 1_024;
export const MAX_EXCERPTS = 4;
export const MAX_SOURCE_NOTES = 2;
export const MAX_FAQ_ROWS = 10;
export const MAX_FAQ_CHARS = 2_000;
export const MAX_REVIEWED_CHARS = 3_000;
export const MAX_BIBLE_CHARS = 2_000;
export const MAX_OVERVIEW_CHARS = 2_000;

export const LOCAL_MAX_FAQ_CHARS = 600;
export const LOCAL_MAX_REVIEWED_CHARS = 800;
export const LOCAL_MAX_BIBLE_CHARS = 600;
export const LOCAL_MAX_OVERVIEW_CHARS = 600;
export const LOCAL_MAX_PROMPT_CHARS = 6_000;
export const MAX_RUN_SOURCES = 12;
export const MAX_RUN_LANES = 8;
export const REQUEST_DEADLINE_MS = 30_000;
export const LOCAL_SYNTHESIS_DEADLINE_MS = 120_000;
export const SYNTHESIS_MAX_OUTPUT_TOKENS = 700;
export const HISTORY_TTL_MS = 60 * 60 * 1_000;
export const HISTORY_SCHEMA_VERSION = 2;
