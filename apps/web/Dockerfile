# check=skip=SecretsUsedInArgOrEnv
# CUSTOMER_TEMPLATE_KEY only names which committed template this artifact
# carries. The check fires on the substring "KEY"; no secret is a build arg.

FROM node:24.19.0-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY patches patches
COPY apps/web/package.json apps/web/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/cache-invalidation/package.json packages/cache-invalidation/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/customer-template/package.json packages/customer-template/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/market-chart/package.json packages/market-chart/package.json
COPY packages/model-gateway/package.json packages/model-gateway/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/api packages/api
COPY packages/auth packages/auth
COPY packages/cache-invalidation packages/cache-invalidation
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/customer-template packages/customer-template
COPY packages/db packages/db
COPY packages/env packages/env
COPY packages/i18n packages/i18n
COPY packages/market-chart packages/market-chart
COPY packages/model-gateway packages/model-gateway
COPY packages/storage packages/storage
COPY packages/ui packages/ui

ARG CUSTOMER_TEMPLATE_KEY
# Without the guard an empty argument would turn the COPY below into "every
# customer's template", which is the one thing this artifact must not contain.
RUN test -n "${CUSTOMER_TEMPLATE_KEY}" \
  || (echo "build failed [MISSING_TEMPLATE_KEY]: pass --build-arg CUSTOMER_TEMPLATE_KEY" >&2 && exit 1)
COPY customer-templates/${CUSTOMER_TEMPLATE_KEY}/ customer-templates/${CUSTOMER_TEMPLATE_KEY}/

ENV NODE_ENV=production
# Build values arrive as a BuildKit secret file, never as a build arg or image
# ENV. Without the mount the placeholders below keep a local build working.
RUN --mount=type=secret,id=web_build \
    if [ -f /run/secrets/web_build ]; then set -a; . /run/secrets/web_build; set +a; fi; \
    CUSTOMER_TEMPLATE_KEY=${CUSTOMER_TEMPLATE_KEY} \
    DATABASE_URL="${DATABASE_URL:-postgresql://build:build@127.0.0.1:1/build}" \
    BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-build-only-placeholder-secret-32-chars}" \
    BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://localhost:3001}" \
    APP_URL="${APP_URL:-http://localhost:3001}" \
    ASSISTANT_APPROVAL_SECRET="${ASSISTANT_APPROVAL_SECRET:-build-only-assistant-approval-secret-32-chars}" \
    pnpm --dir apps/web run build
# standalone output excludes public/; ensure it exists so the runner copy never fails
RUN mkdir -p apps/web/public
RUN mkdir -p /operator-admin \
  && pnpm --filter web exec esbuild \
    scripts/create-operator.ts scripts/reset-operator-password.ts \
    --bundle \
    --platform=node \
    --format=cjs \
    --target=node24 \
    --conditions=react-server \
    --out-extension:.js=.cjs \
    --outdir=/operator-admin

FROM node:24.19.0-slim AS admin
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs operator
COPY --from=builder --chown=operator:nodejs /operator-admin ./operator-admin
USER operator
ENTRYPOINT ["node"]
CMD ["/app/operator-admin/create-operator.cjs"]

# apps/worker builds the prestart command that must run without a workspace
# install; ship that bundle into both runtime images.
FROM node:24.19.0-slim AS prestart
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY patches patches
COPY apps/worker/package.json apps/worker/package.json
COPY packages/cache-invalidation/package.json packages/cache-invalidation/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/customer-template/package.json packages/customer-template/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/market-chart/package.json packages/market-chart/package.json
COPY packages/model-gateway/package.json packages/model-gateway/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts

COPY apps/worker apps/worker
COPY packages/cache-invalidation packages/cache-invalidation
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/customer-template packages/customer-template
COPY packages/db packages/db
COPY packages/env packages/env
COPY packages/i18n packages/i18n
COPY packages/market-chart packages/market-chart
COPY packages/model-gateway packages/model-gateway
COPY packages/storage packages/storage
RUN pnpm --filter worker build:bundle

FROM node:24.19.0-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/build-metadata.json ./prestart/build-metadata.json
COPY --from=prestart --chown=nextjs:nodejs /app/apps/worker/dist/prestart.js ./prestart/prestart.js
COPY --chmod=0755 apps/web/docker-entrypoint.sh ./docker-entrypoint.sh

ENV HOSTNAME=0.0.0.0
ENV PORT=3001
EXPOSE 3001

USER nextjs
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "apps/web/server.js"]
