import "@rz-chain-reporter/env/web";
import path from "node:path";
import { validateBuildEnv } from "@rz-chain-reporter/env/build";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
// Relative: the config loader does not resolve the `@/*` tsconfig alias.
import { MAX_RPC_MULTIPART_BODY_BYTES } from "./src/lib/payload-limits";

const buildEnv = validateBuildEnv(process.env);

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  deploymentId: buildEnv.APP_VERSION,
  cacheComponents: true,
  partialPrefetching: true,
  typedRoutes: true,
  typescript: {
    ignoreBuildErrors: process.env.CHAINREPORTER_TYPES_CHECKED === "1",
  },
  reactCompiler: true,
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  outputFileTracingIncludes: {
    "/*": [
      `../../customer-templates/${buildEnv.CUSTOMER_TEMPLATE_KEY}/**`,
      // The tracer misses the module-sync export for `@swc/helpers/_/*`;
      // include its ESM files so the standalone image boots.
      "../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/esm/**",
    ],
  },
  // Server Function argument logging is on by default in development and prints
  // the sign-in password into the `next dev` terminal in plain text.
  logging: { serverFunctions: false },
  // Otherwise Turbopack picks a stray lockfile above the repo as the workspace root.
  turbopack: {
    root: path.join(import.meta.dirname, "../.."),
  },
  experimental: {
    globalNotFound: true,
    serverActions: {
      bodySizeLimit: MAX_RPC_MULTIPART_BODY_BYTES,
      allowedOrigins: [new URL(buildEnv.APP_URL).host],
    },
  },
};

export default withNextIntl(nextConfig);
