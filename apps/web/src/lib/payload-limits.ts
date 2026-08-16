// Shared by the RPC Content-Length check, body-limit plugin, and
// `serverActions.bodySizeLimit`. Control payloads only.
export const MAX_CONTROL_PAYLOAD_BYTES = 1024 * 1024;
