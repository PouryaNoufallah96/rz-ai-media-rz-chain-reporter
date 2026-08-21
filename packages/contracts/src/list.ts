import { z } from "zod";

export const okSchema = z.object({ ok: z.literal(true) });

const MAX_PAGE = 10_000;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 200;

const sortDirectionSchema = z.enum(["asc", "desc"], {
  error: "orderByInvalid",
});

export function createListInput<
  const TColumns extends readonly [string, ...string[]],
>(orderableColumns: TColumns) {
  return z.object({
    orderBy: z.tuple(
      [
        z.enum(orderableColumns, { error: "orderByInvalid" }),
        sortDirectionSchema,
      ],
      { error: "orderByInvalid" },
    ),
    page: z
      .int({ error: "pageInvalid" })
      .min(1, { error: "pageOutOfRange" })
      .max(MAX_PAGE, { error: "pageOutOfRange" }),
    perPage: z
      .int({ error: "perPageInvalid" })
      .min(1, { error: "perPageOutOfRange" })
      .max(MAX_PAGE_SIZE, { error: "perPageOutOfRange" }),
    search: z
      .string()
      .max(MAX_SEARCH_LENGTH, { error: "searchTooLong" })
      .nullable(),
  });
}

export function createListOutput<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    items: z.array(item),
    page: z.int(),
    perPage: z.int(),
    total: z.int(),
  });
}

export function createOrderedListOutput<TItem extends z.ZodType>(item: TItem) {
  return createListOutput(item).extend({ orderedIds: z.array(z.uuid()) });
}

export const idSchema = z.object({ id: z.uuid({ error: "idInvalid" }) });

export type IdInput = z.infer<typeof idSchema>;

export const setActiveSchema = idSchema.extend({
  active: z.boolean({ error: "activeInvalid" }),
});

export type SetActiveInput = z.infer<typeof setActiveSchema>;

const MAX_REORDERED_IDS = 500;

export const reorderSchema = z.object({
  orderedIds: z
    .array(z.uuid({ error: "idInvalid" }), { error: "orderedIdsInvalid" })
    .min(1, { error: "orderedIdsEmpty" })
    .max(MAX_REORDERED_IDS, { error: "orderedIdsTooMany" }),
});

export type ReorderInput = z.infer<typeof reorderSchema>;
