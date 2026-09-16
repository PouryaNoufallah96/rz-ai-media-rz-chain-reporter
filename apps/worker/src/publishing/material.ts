import type { loadPublicationExecutionContext } from "@rz-chain-reporter/db/repositories/publication";

import { type PublishMaterial, publishMaterialSchema } from "./port";

type PublicationExecutionContext = NonNullable<
  Awaited<ReturnType<typeof loadPublicationExecutionContext>>
>;

export function publicationMaterialFromExecutionContext(
  context: PublicationExecutionContext,
): PublishMaterial {
  return publishMaterialSchema.parse({
    contentLocale: context.draft.contentLocale,
    destinationKey: context.destination.key,
    draft: {
      body: context.draft.body,
      hashtags: context.draft.hashtags,
      headline: context.draft.headline,
    },
    media: context.media
      ? {
          actualBytes: context.media.actualBytes,
          mimeType: context.media.mimeType,
          objectKey: context.media.objectKey,
        }
      : null,
    platform: context.publishOperation.platform,
    source:
      context.sourceItem && context.sourceRevision
        ? {
            attribution: context.sourceItem.attribution,
            canonicalUrl: context.sourceRevision.canonicalUrl,
          }
        : null,
  });
}
