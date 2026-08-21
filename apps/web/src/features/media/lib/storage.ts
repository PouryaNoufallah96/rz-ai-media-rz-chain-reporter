import "server-only";

import { env } from "@rz-chain-reporter/env/server";
import { storageFromBindings } from "@rz-chain-reporter/storage";

export function mediaStorage() {
  return storageFromBindings(env);
}
