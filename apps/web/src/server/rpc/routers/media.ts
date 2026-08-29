import "server-only";

import { installationProcedure } from "@rz-chain-reporter/api";
import { confirmedMediaAssetLifecycleSchema } from "@rz-chain-reporter/contracts";
import { readLiveDraftOrigin } from "@rz-chain-reporter/db/repositories/draft-origin";
import { confirmMediaUpload } from "@rz-chain-reporter/db/repositories/media-asset";
import { ObjectStoreUnboundError } from "@rz-chain-reporter/storage";

import { createUploadIntent } from "@/features/media/lib/upload";
import {
  confirmMediaUploadInputSchema,
  createMediaUploadInputSchema,
  mediaUploadConfirmationSchema,
  mediaUploadIntentSchema,
} from "@/features/media/schemas/upload";

import { rpcDb } from "../db";

const mediaErrors = {
  OBJECT_STORE_UNBOUND: { status: 503 },
  NOT_FOUND: { status: 404 },
  UPLOAD_EXPIRED: { status: 409 },
  VERSION_CONFLICT: { status: 409 },
} as const;

export const createIntent = installationProcedure
  .input(createMediaUploadInputSchema)
  .output(mediaUploadIntentSchema)
  .errors(mediaErrors)
  .handler(async ({ context, errors, input }) => {
    try {
      const asset = await createUploadIntent(
        rpcDb(),
        context.workspaceId,
        input,
      );
      if (!asset.uploadExpiresAt) {
        throw new Error("media upload intent has no expiry");
      }
      return {
        mediaAssetId: asset.id,
        lifecycle: "pending" as const,
        uploadExpiresAt: asset.uploadExpiresAt,
      };
    } catch (error) {
      if (error instanceof ObjectStoreUnboundError) {
        throw errors.OBJECT_STORE_UNBOUND();
      }
      throw error;
    }
  });

export const confirm = installationProcedure
  .input(confirmMediaUploadInputSchema)
  .output(mediaUploadConfirmationSchema)
  .errors(mediaErrors)
  .handler(async ({ context, errors, input }) => {
    const ownedDraft = await readLiveDraftOrigin(
      rpcDb(),
      context.workspaceId,
      context.session.user.id,
      input.platformDraftId,
    );
    if (!ownedDraft) throw errors.NOT_FOUND();
    const result = await confirmMediaUpload(rpcDb(), context.workspaceId, {
      id: input.mediaAssetId,
      actor: context.session.user.id,
      requestId: context.requestId,
    });
    if (result.status === "not_found") throw errors.NOT_FOUND();
    if (result.status === "expired") throw errors.UPLOAD_EXPIRED();
    if (result.status === "conflict") throw errors.VERSION_CONFLICT();
    const lifecycle = confirmedMediaAssetLifecycleSchema.safeParse(
      result.asset.lifecycle,
    );
    if (!lifecycle.success) throw errors.VERSION_CONFLICT();
    return {
      mediaAssetId: result.asset.id,
      lifecycle: lifecycle.data,
      replayed: result.status === "replayed",
    };
  });
