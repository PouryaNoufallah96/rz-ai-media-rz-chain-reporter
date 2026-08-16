FROM node:24.19.0-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/env/package.json packages/env/package.json
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile

COPY apps/worker apps/worker
COPY packages/api packages/api
COPY packages/auth packages/auth
COPY packages/config packages/config
COPY packages/db packages/db
COPY packages/env packages/env
RUN pnpm --filter worker build

FROM node:24.19.0-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs worker
COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist ./dist
USER worker
CMD ["node", "dist/main.js"]
