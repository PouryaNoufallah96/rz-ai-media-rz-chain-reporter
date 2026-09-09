import type {
  LoadedReviewedKnowledge,
  ReviewedKnowledgeDocument,
} from "@rz-chain-reporter/customer-template/load";
import type { ReviewedKnowledgeFaqRow } from "@rz-chain-reporter/customer-template/schema";
import type { Locale } from "@rz-chain-reporter/i18n";

import {
  MAX_BIBLE_CHARS,
  MAX_EXCERPTS,
  MAX_FAQ_CHARS,
  MAX_FAQ_ROWS,
  MAX_OVERVIEW_CHARS,
  MAX_REVIEWED_CHARS,
} from "../constants";

export type KnowledgeExcerpt = {
  title: string;
  section: string | null;
  locale: Locale | null;
  sha256: string;
  text: string;
};

export type Brand = { key: string; name: string };

export type AssistantKnowledge = {
  faq: readonly ReviewedKnowledgeFaqRow[];
  faqSource: KnowledgeExcerpt | null;
  overview: readonly KnowledgeExcerpt[];
  matches: readonly KnowledgeExcerpt[];
  bibles: readonly KnowledgeExcerpt[];
  brandChoice: readonly Brand[] | null;
};

const WORD = /[\p{L}\p{N}]+/gu;

const MAX_BRAND_CHOICES = 4;

// Referring to one unnamed brand is the ambiguity the choice resolves. A plural
// reference asks across brands, and a chooser would not answer it.
const BRAND_WORDS = ["brand", "برند", "رسانه"];

const BRAND_PLURALS = ["brands", "برندها", "برند ها", "رسانه ها", "رسانه های"];

// Selection floor, not an answer gate: a barely-overlapping section would only
// add noise and a source note the answer never used.
const MIN_SECTION_SCORE = 0.12;

function normalizeQuestion(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[‌‏‎]/g, " ")
    .trim();
}

function tokens(value: string) {
  return new Set(normalizeQuestion(value).match(WORD) ?? []);
}

function overlap(
  question: ReadonlySet<string>,
  candidate: ReadonlySet<string>,
) {
  if (question.size === 0 || candidate.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const token of question) {
    if (candidate.has(token)) {
      shared += 1;
    }
  }

  return shared / Math.sqrt(question.size * candidate.size);
}

function rankFaq(rows: readonly ReviewedKnowledgeFaqRow[], question: string) {
  const asked = tokens(question);

  const ranked = rows
    .map((row) => ({
      row,
      score: overlap(
        asked,
        tokens([row.question, ...row.aliases, ...row.keywords].join(" ")),
      ),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || right.row.priority - left.row.priority,
    )
    .slice(0, MAX_FAQ_ROWS);

  const selected: ReviewedKnowledgeFaqRow[] = [];
  let budget = MAX_FAQ_CHARS;

  for (const { row } of ranked) {
    const length = row.question.length + row.answer.length + 1;

    if (length > budget) continue;

    selected.push(row);
    budget -= length;
  }

  return selected;
}

function splitSections(text: string) {
  const sections: { heading: string | null; body: string }[] = [];
  let heading: string | null = null;
  let body: string[] = [];

  const flush = () => {
    const joined = body.join("\n").trim();

    if (joined.length > 0) {
      sections.push({ heading, body: joined });
    }

    body = [];
  };

  for (const line of text.split("\n")) {
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line.trim());

    if (headingMatch?.[1]) {
      flush();
      heading = headingMatch[1].trim();
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }

    body.push(line);
  }

  flush();

  return sections;
}

function documentTitle(text: string, fallback: string) {
  return /^#\s+(.*)$/m.exec(text)?.[1]?.trim() ?? fallback;
}

function fill(
  candidates: readonly (KnowledgeExcerpt & {
    brandKey: string;
    score: number;
  })[],
  charBudget: number,
  maxCount: number,
) {
  const selected: KnowledgeExcerpt[] = [];
  let budget = charBudget;

  for (const {
    brandKey: _brandKey,
    score: _score,
    ...candidate
  } of candidates) {
    if (selected.length === maxCount) break;
    if (candidate.text.length > budget) continue;

    selected.push(candidate);
    budget -= candidate.text.length;
  }

  return selected;
}

function sectionsOf(
  document: ReviewedKnowledgeDocument,
  asked: ReadonlySet<string>,
) {
  const title = documentTitle(document.text, document.id);

  return splitSections(document.text).map((section) => ({
    title,
    section: section.heading,
    locale: document.locale,
    sha256: document.sha256,
    text: section.body,
    score: overlap(asked, tokens(`${section.heading ?? ""} ${section.body}`)),
  }));
}

function preferredDocuments(
  documents: readonly ReviewedKnowledgeDocument[],
  locale: Locale,
  predicate: (document: ReviewedKnowledgeDocument) => boolean,
) {
  const matching = documents.filter(predicate);
  const localized = matching.filter((document) => document.locale === locale);

  return localized.length > 0
    ? localized
    : matching.filter((document) => document.locale === "en");
}

// `normalizeQuestion` turns a zero-width joiner into a space, so a Persian
// plural reaches this as two words.
function asksAboutOneBrand(normalized: string) {
  return (
    BRAND_WORDS.some((word) => normalized.includes(word)) &&
    !BRAND_PLURALS.some((word) => normalized.includes(word))
  );
}

function namedBrands(
  brands: readonly Brand[],
  question: string,
  cardBrandKey: string | null,
) {
  const normalized = normalizeQuestion(question);

  return brands.filter(
    (brand) =>
      brand.key === cardBrandKey ||
      normalized.includes(normalizeQuestion(brand.key)) ||
      normalized.includes(normalizeQuestion(brand.name)),
  );
}

export function brandOptions(
  brands: readonly Brand[],
  brandKeys: readonly string[],
) {
  if (brandKeys.length === 0) {
    return brands.slice(0, MAX_BRAND_CHOICES);
  }

  const selected = new Set(brandKeys);
  const matched: Brand[] = [];

  for (const brand of brands) {
    if (!selected.has(brand.key)) {
      continue;
    }

    matched.push(brand);
    if (matched.length === MAX_BRAND_CHOICES) {
      break;
    }
  }

  return matched;
}

export function selectKnowledge(input: {
  brands: readonly Brand[];
  brandKeys: readonly string[];
  cardBrandKey: string | null;
  knowledge: LoadedReviewedKnowledge;
  locale: Locale;
  question: string;
}): AssistantKnowledge {
  const asked = tokens(input.question);
  const normalized = normalizeQuestion(input.question);
  const selectedKeys = new Set(input.brandKeys);
  const inQuestion = namedBrands(
    input.brands,
    input.question,
    input.cardBrandKey,
  );
  // A single selected brand names itself: whatever the operator asks is about
  // it, including after they answer the chooser.
  const named =
    inQuestion.length > 0 || input.brandKeys.length !== 1
      ? inQuestion
      : input.brands.filter((brand) => selectedKeys.has(brand.key));
  const namedByKey = new Map(named.map((brand) => [brand.key, brand]));
  const namedKeys = new Set(namedByKey.keys());

  const overviewDocuments = preferredDocuments(
    input.knowledge.documents,
    input.locale,
    (document) => document.kind === "workspace-overview",
  );
  const brandDocuments = input.brands.flatMap((brand) =>
    preferredDocuments(
      input.knowledge.documents,
      input.locale,
      (document) =>
        document.kind === "brand-chat" && document.brandKey === brand.key,
    ),
  );

  const rankedOverview = overviewDocuments.flatMap((document) =>
    sectionsOf(document, asked).map((section) => ({
      ...section,
      brandKey: "workspace",
    })),
  );
  rankedOverview.sort((left, right) => right.score - left.score);
  const overview = fill(rankedOverview, MAX_OVERVIEW_CHARS, MAX_EXCERPTS);

  const rankedMatches: (KnowledgeExcerpt & {
    brandKey: string;
    score: number;
  })[] = [];

  for (const document of brandDocuments) {
    const { brandKey } = document;

    if (
      brandKey === null ||
      (namedKeys.size > 0
        ? !namedKeys.has(brandKey)
        : input.brandKeys.length > 0 && !selectedKeys.has(brandKey))
    ) {
      continue;
    }

    for (const section of sectionsOf(document, asked)) {
      if (section.score >= MIN_SECTION_SCORE) {
        rankedMatches.push({ ...section, brandKey });
      }
    }
  }

  rankedMatches.sort((left, right) => right.score - left.score);
  const matches = fill(rankedMatches, MAX_REVIEWED_CHARS, MAX_EXCERPTS);

  // A named brand always contributes its bible, ranked but never gated: with no
  // lexical hit the leading sections carry the brand's identity.
  const rankedBibles: (KnowledgeExcerpt & {
    brandKey: string;
    score: number;
  })[] = [];

  for (const bible of input.knowledge.brandBibles) {
    if (!namedKeys.has(bible.brandKey)) {
      continue;
    }

    const brandName = namedByKey.get(bible.brandKey)?.name ?? bible.brandKey;

    for (const section of splitSections(bible.text)) {
      rankedBibles.push({
        brandKey: bible.brandKey,
        title: brandName,
        section: section.heading,
        locale: null,
        sha256: bible.sha256,
        text: section.body,
        score: overlap(
          asked,
          tokens(`${brandName} ${section.heading ?? ""} ${section.body}`),
        ),
      });
    }
  }

  // Sort is stable, so an unmatched bible keeps its leading sections first.
  rankedBibles.sort((left, right) => right.score - left.score);
  const bibles = fill(rankedBibles, MAX_BIBLE_CHARS, MAX_EXCERPTS);

  const choices = brandOptions(input.brands, input.brandKeys);
  const faqLocale =
    (input.knowledge.faqByLocale[input.locale]?.length ?? 0) > 0
      ? input.locale
      : (input.knowledge.faqByLocale.en?.length ?? 0) > 0
        ? "en"
        : null;
  const faq = rankFaq(
    faqLocale ? (input.knowledge.faqByLocale[faqLocale] ?? []) : [],
    input.question,
  );
  const faqSource = faqLocale
    ? input.knowledge.faqSourceByLocale[faqLocale]
    : undefined;

  return {
    faq,
    faqSource:
      faq.length > 0 && faqSource
        ? {
            title: faqSource.title,
            section: null,
            locale: faqSource.locale,
            sha256: faqSource.sha256,
            text: "",
          }
        : null,
    overview,
    matches,
    bibles,
    // A brand-document match is not ambiguous; arm the chooser only for one
    // unnamed brand when brand knowledge would answer the question.
    brandChoice:
      namedKeys.size === 0 &&
      choices.length > 1 &&
      matches.length > 0 &&
      asksAboutOneBrand(normalized)
        ? choices
        : null,
  };
}
