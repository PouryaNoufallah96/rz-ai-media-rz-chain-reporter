import "@rz-chain-reporter/env/web";
import path from "node:path";
import { validateBuildEnv } from "@rz-chain-reporter/env/build";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
// Relative: the config loader does not resolve the `@/*` tsconfig alias.
import { MAX_CONTROL_PAYLOAD_BYTES } from "./src/lib/payload-limits";

validateBuildEnv(process.env);

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  typedRoutes: true,
  reactCompiler: true,
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // Otherwise Turbopack picks a stray lockfile above the repo as the workspace root.
  turbopack: {
    root: path.join(import.meta.dirname, "../.."),
  },
  experimental: {
    globalNotFound: true,
    serverActions: { bodySizeLimit: MAX_CONTROL_PAYLOAD_BYTES },
  },
};

export default withNextIntl(nextConfig);
