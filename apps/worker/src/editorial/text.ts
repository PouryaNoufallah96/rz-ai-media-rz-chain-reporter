export const NORMALIZATION_VERSION = "1";

const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/gu;
const WHITESPACE_RUN = /\s+/gu;

export function normalizeText(value: string): string {
  return foldDigits(value.normalize("NFKC"))
    .toLowerCase()
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

export function matchTerms(
  normalized: string,
  terms: readonly { term: string; weight: number }[],
  aliases: readonly { canonical: string; surfaces: readonly string[] }[],
): { hits: number; weight: number } {
  let hits = 0;
  let weight = 0;

  for (const entry of terms) {
    if (matchesTerm(normalized, normalizeText(entry.term), aliases)) {
      hits += 1;
      weight += entry.weight;
    }
  }

  return { hits, weight };
}

function matchesTerm(
  normalized: string,
  term: string,
  aliases: readonly { canonical: string; surfaces: readonly string[] }[],
): boolean {
  if (containsTerm(normalized, term)) {
    return true;
  }

  for (const alias of aliases) {
    const group = [alias.canonical, ...alias.surfaces].map(normalizeText);
    if (!group.includes(term)) {
      continue;
    }

    for (const surface of group) {
      if (containsTerm(normalized, surface)) {
        return true;
      }
    }
  }

  return false;
}

function containsTerm(normalized: string, term: string): boolean {
  if (term.length === 0) {
    return false;
  }

  let from = 0;

  for (;;) {
    const at = normalized.indexOf(term, from);
    if (at < 0) {
      return false;
    }

    const before = at === 0 ? "" : (normalized[at - 1] ?? "");
    const after = normalized[at + term.length] ?? "";
    if (!WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after)) {
      return true;
    }

    from = at + 1;
  }
}

function foldDigits(value: string): string {
  return value.replace(ARABIC_INDIC_DIGIT, (digit) => {
    const code = digit.codePointAt(0) ?? 0;
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}
