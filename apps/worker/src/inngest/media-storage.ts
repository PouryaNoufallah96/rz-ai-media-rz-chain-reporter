import { storageFromBindings } from "@rz-chain-reporter/storage";

import { workerEnv } from "../runtime/env";

export function workerStorage() {
  return storageFromBindings(workerEnv);
}
