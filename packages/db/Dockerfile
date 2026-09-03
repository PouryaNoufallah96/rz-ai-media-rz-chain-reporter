# check=skip=SecretsUsedInArgOrEnv
# CUSTOMER_TEMPLATE_KEY only names which committed template this artifact
# carries. The check fires on the substring "KEY"; no secret is a build arg.

FROM node:24.19.0-slim AS migrator
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY patches patches
COPY packages/cache-invalidation/package.json packages/cache-invalidation/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/customer-template/package.json packages/customer-template/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/i18n/package.json packages/i18n/package.json
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile

COPY packages/cache-invalidation packages/cache-invalidation
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/customer-template packages/customer-template
COPY packages/db packages/db
COPY packages/env packages/env
COPY packages/i18n packages/i18n

ARG CUSTOMER_TEMPLATE_KEY
RUN test -n "${CUSTOMER_TEMPLATE_KEY}" \
  || (echo "build failed [MISSING_TEMPLATE_KEY]: pass --build-arg CUSTOMER_TEMPLATE_KEY" >&2 && exit 1)
COPY customer-templates/${CUSTOMER_TEMPLATE_KEY}/ customer-templates/${CUSTOMER_TEMPLATE_KEY}/

CMD ["pnpm", "--dir", "packages/db", "run", "db:migrate"]
