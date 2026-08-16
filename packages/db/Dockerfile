FROM node:24.19.0-slim AS migrator
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/env/package.json packages/env/package.json
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile

COPY packages/config packages/config
COPY packages/db packages/db
COPY packages/env packages/env
CMD ["pnpm", "--dir", "packages/db", "run", "db:migrate"]
