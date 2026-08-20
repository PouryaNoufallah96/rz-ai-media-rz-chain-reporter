import {
  platformSchema,
  sourceOriginSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

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
      origin: sourceOriginSchema,
      endpoint: z.string(),
      enabled: z.boolean(),
    }),
  ),
  destinations: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      platform: platformSchema,
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
