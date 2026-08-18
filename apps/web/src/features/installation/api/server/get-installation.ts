import "server-only";

import { requireSession } from "@/features/auth/api/server/session";
import { createRequestClient } from "@/lib/orpc.server";

// requireSession turns an anonymous read into the login redirect, not a rendered error.
export async function getInstallationOverview() {
  await requireSession();

  const client = await createRequestClient();
  return client.installation.overview();
}
