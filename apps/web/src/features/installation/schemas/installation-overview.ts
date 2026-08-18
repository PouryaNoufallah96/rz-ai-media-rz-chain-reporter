import { z } from "zod";

// `origin` and `platform` stay plain strings here: their value sets are owned by
// the packages/db pgEnums, and packages/db must not be reachable from a schema
// the browser can import.
const installationIdentitySchema = z.object({
  workspaceName: z.string(),
  templateKey: z.string().nullable(),
  templateSchemaVersion: z.int(),
  templateFingerprintShort: z.string().nullable(),
  templateAppliedAt: z.date().nullable(),
});

const destinationBindingStateSchema = z.enum([
  "bound",
  "unbound",
  "unchecked",
  "disabledByTemplate",
]);

export type DestinationBindingState = z.infer<
  typeof destinationBindingStateSchema
>;

export const installationOverviewSchema = z.object({
  identity: installationIdentitySchema,
  mediaBrands: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      destinationKeys: z.array(z.string()),
    }),
  ),
  sources: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      origin: z.string(),
      endpoint: z.string(),
      enabled: z.boolean(),
    }),
  ),
  destinations: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      platform: z.string(),
      binding: destinationBindingStateSchema,
      bindingCheckedAt: z.date().nullable(),
      instagram: z
        .object({
          professionalAccountId: z.string(),
          username: z.string().nullable(),
        })
        .nullable(),
    }),
  ),
});

export type InstallationOverview = z.infer<typeof installationOverviewSchema>;

export const destinationMetadataSchema = z.object({ label: z.string() });

export const instagramMetadataSchema = z.object({
  label: z.string(),
  professionalAccountId: z.string(),
  username: z.string().optional(),
});
