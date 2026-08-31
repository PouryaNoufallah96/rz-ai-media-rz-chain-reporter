import type { ContentLocale } from "@rz-chain-reporter/contracts";

const ARABIC_SCRIPT = /\p{Script=Arabic}/u;
const LATIN_SCRIPT = /\p{Script=Latin}/u;
const LOCALE_RULES = {
  en: {
    currencyWord: /(?<![\p{L}\p{N}_])dollars?(?![\p{L}\p{N}_])/iu,
    languageName: "English",
    percentageWord: /(?<![\p{L}\p{N}_])percent(?:age)?(?![\p{L}\p{N}_])/iu,
    script: LATIN_SCRIPT,
  },
  fa: {
    currencyWord: /(?<![\p{L}\p{N}_])دلار(?:ی)?(?![\p{L}\p{N}_])/u,
    languageName: "Persian",
    percentageWord: /(?<![\p{L}\p{N}_])درصد(?:ی)?(?![\p{L}\p{N}_])/u,
    script: ARABIC_SCRIPT,
  },
} satisfies Record<
  ContentLocale,
  {
    currencyWord: RegExp;
    languageName: string;
    percentageWord: RegExp;
    script: RegExp;
  }
>;
const LETTER = /\p{L}/u;
const DOLLAR_AMOUNT = /\$\s*[+-]?\p{N}/u;
const DOLLAR_CURRENCY_CODE = /(?<![\p{L}\p{N}_])USD(?![\p{L}\p{N}_])/iu;
const PERCENT_AMOUNT = /\p{N}\s*[%٪]/u;
const PROTECTED_TOKEN =
  /(?:https?:\/\/|www\.)[^\s<>"'«»،؛]*[^\s<>"'«».,!?،؛:;)\]}]|\$[+-]?\p{N}+(?:[.,:/\-٫٬]\p{N}+)*|\$[\p{L}][\p{L}\p{N}_]*(?:[./:-][\p{L}\p{N}_]+)*|[#@][\p{L}\p{N}_]+(?:[.-][\p{L}\p{N}_]+)*|[+-]?\p{N}+(?:[.,:/\-٫٬]\p{N}+)*/gu;

export function contentLanguageName(locale: ContentLocale) {
  return LOCALE_RULES[locale].languageName;
}

export function translatedTextMatchesLocale(
  locale: ContentLocale,
  source: string,
  translated: string | null,
) {
  if (
    translated === null ||
    !preservesDollarCurrency(locale, source, translated) ||
    !preservesPercentage(locale, source, translated) ||
    !preservesProtectedTokens(source, translated)
  ) {
    return false;
  }
  if (!LETTER.test(source.replace(PROTECTED_TOKEN, " "))) {
    return protectedOnlyTranslationMatches(locale, source, translated);
  }
  const localizableText = translated.replace(PROTECTED_TOKEN, " ");
  return requestedScriptDominates(locale, localizableText);
}

export function translatedFreeTextIsUsable(
  locale: ContentLocale,
  source: string,
  translated: string | null,
) {
  if (
    translated === null ||
    translated.trim().length === 0 ||
    !preservesPresentationIdentityTokens(source, translated)
  ) {
    return false;
  }

  const sourceText = source.replace(PROTECTED_TOKEN, " ");
  const translatedText = translated.replace(PROTECTED_TOKEN, " ");
  if (!LETTER.test(sourceText)) {
    return (
      !LETTER.test(translatedText) ||
      LOCALE_RULES[locale].script.test(translatedText)
    );
  }
  return LOCALE_RULES[locale].script.test(translatedText);
}

export function translatedPresentationTextIsUsable(
  locale: ContentLocale,
  source: string,
  translated: string | null,
) {
  return translatedFreeTextIsUsable(locale, source, translated);
}

function protectedOnlyTranslationMatches(
  locale: ContentLocale,
  source: string,
  translated: string,
) {
  const localeRules = LOCALE_RULES[locale];
  if (normalizeNumericGlyphs(translated) === normalizeNumericGlyphs(source)) {
    return true;
  }

  const localizedMarkerText = translated.replace(PROTECTED_TOKEN, " ");
  let remainingText = localizedMarkerText;
  if (DOLLAR_AMOUNT.test(source)) {
    remainingText = removeMatches(remainingText, DOLLAR_CURRENCY_CODE);
    remainingText = removeMatches(remainingText, localeRules.currencyWord);
  }
  if (PERCENT_AMOUNT.test(source)) {
    remainingText = removeMatches(remainingText, localeRules.percentageWord);
  }
  return !LETTER.test(remainingText);
}

function removeMatches(value: string, pattern: RegExp) {
  let result = value;
  while (pattern.test(result)) result = result.replace(pattern, " ");
  return result;
}

function requestedScriptDominates(locale: ContentLocale, value: string) {
  const requestedScript = LOCALE_RULES[locale].script;
  let requestedLetters = 0;
  let otherLetters = 0;
  for (const character of value) {
    if (!LETTER.test(character)) continue;
    if (requestedScript.test(character)) requestedLetters += 1;
    else otherLetters += 1;
  }
  return requestedLetters > otherLetters;
}

function preservesProtectedTokens(source: string, translated: string) {
  return sameTokenCounts(protectedTokens(source), protectedTokens(translated));
}

function preservesPresentationIdentityTokens(
  source: string,
  translated: string,
) {
  return sameTokenCounts(
    presentationIdentityTokens(source),
    presentationIdentityTokens(translated),
  );
}

function sameTokenCounts(
  expectedTokens: readonly string[],
  actualTokens: readonly string[],
) {
  const expected = tokenCounts(expectedTokens);
  const actual = tokenCounts(actualTokens);
  if (expected.size !== actual.size) return false;
  return [...expected].every(([token, count]) => actual.get(token) === count);
}

function preservesDollarCurrency(
  locale: ContentLocale,
  source: string,
  translated: string,
) {
  const sourceUsesSymbol = DOLLAR_AMOUNT.test(source);
  const translatedUsesSymbol = DOLLAR_AMOUNT.test(translated);
  if (!sourceUsesSymbol) return !translatedUsesSymbol;
  return (
    translatedUsesSymbol ||
    DOLLAR_CURRENCY_CODE.test(translated) ||
    LOCALE_RULES[locale].currencyWord.test(translated)
  );
}

function preservesPercentage(
  locale: ContentLocale,
  source: string,
  translated: string,
) {
  const sourceUsesSymbol = PERCENT_AMOUNT.test(source);
  const translatedUsesSymbol = PERCENT_AMOUNT.test(translated);
  if (!sourceUsesSymbol) return !translatedUsesSymbol;
  return (
    translatedUsesSymbol || LOCALE_RULES[locale].percentageWord.test(translated)
  );
}

function tokenCounts(tokens: readonly string[]) {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function protectedTokens(value: string) {
  return (value.match(PROTECTED_TOKEN) ?? []).map(normalizedProtectedToken);
}

function presentationIdentityTokens(value: string) {
  return (value.match(PROTECTED_TOKEN) ?? []).filter((token) =>
    /^(?:https?:\/\/|www\.|[#@]|\$\p{L})/u.test(token),
  );
}

function normalizedProtectedToken(token: string) {
  if (/^(?:https?:\/\/|www\.)/u.test(token)) return token;
  if (DOLLAR_AMOUNT.test(token)) {
    return normalizeNumericGlyphs(token.slice(1));
  }
  if (/^[$#@]/u.test(token)) return token;
  return normalizeNumericGlyphs(token);
}

function normalizeNumericGlyphs(value: string) {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) return character;
      if (codePoint >= 0x06f0 && codePoint <= 0x06f9) {
        return String(codePoint - 0x06f0);
      }
      if (codePoint >= 0x0660 && codePoint <= 0x0669) {
        return String(codePoint - 0x0660);
      }
      if (character === "٫") return ".";
      if (character === "٬") return ",";
      if (character === "٪") return "%";
      return character;
    })
    .join("");
}
