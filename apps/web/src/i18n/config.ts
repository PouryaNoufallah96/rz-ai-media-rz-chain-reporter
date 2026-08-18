import type { Formats } from "next-intl";

// Else next-intl bakes the build machine's zone into the static shell.
export const TIME_ZONE = "UTC";

export const FORMATS: Formats = {};

// next-intl's default `now` is build time; relative-time callers pass their own.
export const NOW = new Date(0);
