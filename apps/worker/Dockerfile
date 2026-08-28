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
COPY apps/worker/package.json apps/worker/package.json
COPY packages/cache-invalidation/package.json packages/cache-invalidation/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/customer-template/package.json packages/customer-template/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/model-gateway/package.json packages/model-gateway/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile

COPY apps/worker apps/worker
COPY packages/cache-invalidation packages/cache-invalidation
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/customer-template packages/customer-template
COPY packages/db packages/db
COPY packages/env packages/env
COPY packages/model-gateway packages/model-gateway
COPY packages/storage packages/storage

ARG CUSTOMER_TEMPLATE_KEY
# Without the guard an empty argument would turn the COPY below into "every
# customer's template", which is the one thing this artifact must not contain.
RUN test -n "${CUSTOMER_TEMPLATE_KEY}" \
  || (echo "build failed [MISSING_TEMPLATE_KEY]: pass --build-arg CUSTOMER_TEMPLATE_KEY" >&2 && exit 1)
COPY customer-templates/${CUSTOMER_TEMPLATE_KEY}/ customer-templates/${CUSTOMER_TEMPLATE_KEY}/

ENV NODE_ENV=production
RUN CUSTOMER_TEMPLATE_KEY=${CUSTOMER_TEMPLATE_KEY} pnpm --filter worker build

FROM node:24.19.0-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs worker

ARG CUSTOMER_TEMPLATE_KEY
COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist ./dist
COPY --from=builder --chown=worker:nodejs /app/node_modules/.pnpm ./node_modules/.pnpm
RUN ln -s "$(find node_modules/.pnpm -path '*/node_modules/sharp' -type d -print -quit | sed 's#^node_modules/##')" node_modules/sharp
COPY --from=builder --chown=worker:nodejs /app/customer-templates/${CUSTOMER_TEMPLATE_KEY}/ ./customer-templates/${CUSTOMER_TEMPLATE_KEY}/
COPY --chmod=0755 apps/worker/docker-entrypoint.sh ./docker-entrypoint.sh

USER worker
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
