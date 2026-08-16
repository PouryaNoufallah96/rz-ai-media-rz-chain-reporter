import {
  createLoader,
  createParser,
  type inferParserType,
  type Nullable,
  parseAsInteger,
  parseAsString,
} from "nuqs/server";

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZES = [10, 20, 50, 100] as const;

// Deep offsets are not a product need, and an unbounded page turns into an
// unbounded OFFSET on whichever list adopts these parsers first.
const MAX_PAGE = 10_000;

const ORDER_BY_SEPARATOR = ".";

export type SortDirection = "asc" | "desc";

export type OrderBy<TColumn extends string = string> = readonly [
  column: TColumn,
  direction: SortDirection,
];

// A column without a direction is rejected rather than defaulted, so the
// normalizer never has to invent one for a half-written URL.
const parseAsOrderBy = createParser<OrderBy>({
  parse(queryValue) {
    const separator = queryValue.lastIndexOf(ORDER_BY_SEPARATOR);

    if (separator <= 0) return null;

    const column = queryValue.slice(0, separator);
    const direction = queryValue.slice(separator + 1);

    if (direction !== "asc" && direction !== "desc") return null;

    return [column, direction];
  },
  serialize([column, direction]) {
    return `${column}${ORDER_BY_SEPARATOR}${direction}`;
  },
  eq(left, right) {
    return left[0] === right[0] && left[1] === right[1];
  },
});

export const listSearchParsers = {
  orderBy: parseAsOrderBy,
  page: parseAsInteger.withDefault(DEFAULT_PAGE),
  perPage: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
  q: parseAsString.withDefault(""),
};

export const loadListSearchParams = createLoader(listSearchParsers);

export type ListSearchParams = inferParserType<typeof listSearchParsers>;

export type ListSearchPatch = Partial<Nullable<ListSearchParams>>;

export interface ListQueryConfig<TColumn extends string> {
  readonly defaultOrderBy: OrderBy<TColumn>;
  readonly orderableColumns: readonly TColumn[];
  readonly pageSizes?: readonly number[];
}

export interface ListQuery<TColumn extends string> {
  readonly offset: number;
  readonly orderBy: OrderBy<TColumn>;
  readonly page: number;
  readonly perPage: number;
  readonly search: string | null;
}

function resolvePage(value: number) {
  if (!Number.isSafeInteger(value) || value < DEFAULT_PAGE) return DEFAULT_PAGE;

  return Math.min(value, MAX_PAGE);
}

function resolvePerPage(value: number, pageSizes: readonly number[]) {
  if (pageSizes.includes(value)) return value;

  return pageSizes.includes(DEFAULT_PAGE_SIZE)
    ? DEFAULT_PAGE_SIZE
    : Math.min(...pageSizes);
}

function resolveOrderBy<TColumn extends string>(
  value: OrderBy | null,
  config: ListQueryConfig<TColumn>,
): OrderBy<TColumn> {
  if (value === null) return config.defaultOrderBy;

  const column = config.orderableColumns.find(
    (orderable) => orderable === value[0],
  );

  return column === undefined ? config.defaultOrderBy : [column, value[1]];
}

// `q` is trimmed and collapsed, never uniqueness-folded: folding is a generated
// key on unique-name columns in the database, not a list-search concern.
function resolveSearch(value: string) {
  const search = value.trim().replace(/\s+/gu, " ");

  return search === "" ? null : search;
}

export function normalizeListQuery<TColumn extends string>(
  params: ListSearchParams,
  config: ListQueryConfig<TColumn>,
): ListQuery<TColumn> {
  const page = resolvePage(params.page);
  const perPage = resolvePerPage(
    params.perPage,
    config.pageSizes ?? PAGE_SIZES,
  );

  return {
    offset: (page - 1) * perPage,
    orderBy: resolveOrderBy(params.orderBy, config),
    page,
    perPage,
    search: resolveSearch(params.q),
  };
}

const PAGE_RESETTING_KEYS = ["orderBy", "perPage", "q"] as const;

export function withPageReset(patch: ListSearchPatch): ListSearchPatch {
  const resetsPage = PAGE_RESETTING_KEYS.some((key) => key in patch);

  return resetsPage ? { ...patch, page: DEFAULT_PAGE } : patch;
}
