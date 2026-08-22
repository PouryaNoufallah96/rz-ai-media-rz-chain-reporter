import type { Formats } from "next-intl";

export const FORMATS: Formats = {};

// next-intl's default `now` is build time; relative-time callers pass their own.
export const NOW = new Date(0);
