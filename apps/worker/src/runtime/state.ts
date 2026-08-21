import { ConnectionState, type WorkerConnection } from "inngest/connect";

import type { OutboxRelay } from "../relay/relay";
import type { WorkerRuntimeConfig } from "./config";

export type WorkerCapabilityReport = {
  eventDispatch: "active" | "disabled" | "draining" | "starting";
  functionExecution:
    | "active"
    | "closing"
    | "connecting"
    | "disabled"
    | "reconnecting";
  modelBackends: "active" | "disabled";
  objectStore: "active" | "disabled" | "unbound";
};

function connectionCapability(
  state: ConnectionState | null,
): WorkerCapabilityReport["functionExecution"] {
  switch (state) {
    case ConnectionState.ACTIVE:
      return "active";
    case ConnectionState.CLOSING:
    case ConnectionState.CLOSED:
      return "closing";
    case ConnectionState.PAUSED:
    case ConnectionState.RECONNECTING:
      return "reconnecting";
    case ConnectionState.CONNECTING:
    case null:
      return "connecting";
  }
}

export class WorkerRuntimeState {
  connection: WorkerConnection | null = null;
  relay: OutboxRelay | null = null;
  draining = false;

  constructor(readonly config: WorkerRuntimeConfig) {}

  beginDrain() {
    this.draining = true;
  }

  capabilities(): WorkerCapabilityReport {
    if (this.config.mode === "health-only") {
      return {
        eventDispatch: "disabled",
        functionExecution: "disabled",
        modelBackends: "disabled",
        objectStore: "disabled",
      };
    }

    return {
      eventDispatch: this.draining
        ? "draining"
        : this.relay?.isAccepting
          ? "active"
          : "starting",
      functionExecution: this.draining
        ? "closing"
        : connectionCapability(this.connection?.state ?? null),
      modelBackends: "active",
      objectStore: this.config.objectStore === "bound" ? "active" : "unbound",
    };
  }

  runtimeReady() {
    if (this.draining) {
      return false;
    }
    if (this.config.mode === "health-only") {
      return true;
    }
    return (
      this.connection?.state === ConnectionState.ACTIVE &&
      this.relay?.isAccepting === true &&
      this.config.objectStore === "bound"
    );
  }
}
