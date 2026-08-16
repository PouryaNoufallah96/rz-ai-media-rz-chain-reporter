FROM node:24.19.0-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/api packages/api
COPY packages/auth packages/auth
COPY packages/config packages/config
COPY packages/db packages/db
COPY packages/env packages/env
COPY packages/ui packages/ui

ENV NODE_ENV=production
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build \
    BETTER_AUTH_SECRET=build-only-placeholder-secret-32-chars \
    BETTER_AUTH_URL=http://localhost:3001 \
    CORS_ORIGIN=http://localhost:3001 \
    APP_URL=http://localhost:3001 \
    pnpm --dir apps/web run build
# standalone output excludes public/; ensure it exists so the runner copy never fails
RUN mkdir -p apps/web/public

FROM node:24.19.0-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

ENV HOSTNAME=0.0.0.0
ENV PORT=3001
EXPOSE 3001

USER nextjs
CMD ["node", "apps/web/server.js"]
