import { z } from "zod";

export const postgresUrl = z.url({
  protocol: /^postgres(?:ql)?$/,
});

export const httpUrl = z.url({
  protocol: /^https?$/,
});

export const httpOrigin = httpUrl.refine(
  (value) => value === new URL(value).origin,
  "Expected an HTTP(S) origin without credentials, path, query, or fragment",
);
