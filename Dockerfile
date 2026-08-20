FROM node:20-alpine AS base
RUN apk add --no-cache openssl

# ---------------------------------------------------------------------------
# Build stage — needs dev dependencies for the Next build and prisma generate.
# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts* ./
RUN npm ci

COPY . .
RUN npx prisma generate

# NEXT_PUBLIC_* variables are inlined by Next at build time, so the public
# origin has to be present *here* — setting it at runtime changes nothing,
# because the value is already compiled into the bundle.
#
# A Dockerfile build is isolated from the host environment by design, so a
# platform variable does not reach it unless an ARG opts in. Railway states this
# explicitly. Without the ARG the build silently used the localhost fallback in
# src/lib/site.ts and shipped a live site whose sitemap, robots.txt, canonical
# tags and OpenGraph URLs all said http://localhost:3000 — with a green deploy
# and a healthy /api/health, so nothing looked wrong.
#
# Unset is still safe (the fallback applies); it is just not publishable.
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

RUN npm run build

# ---------------------------------------------------------------------------
# Production dependencies, installed separately so the runner does not carry
# build tooling. `--ignore-scripts` keeps the postinstall prisma generate from
# running here; the generated client is copied from the builder instead.
# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# Prisma CLI, installed on its own so it brings its whole dependency tree.
#
# The runner used to cherry-pick `prisma` and `@prisma` out of the production
# tree. That misses transitive dependencies — `effect`, pulled in by
# @prisma/config — so `prisma migrate deploy` died at container start with
# MODULE_NOT_FOUND, and `set -e` in the entrypoint turned every start into a
# crashloop: build green, deploy "COMPLETED", 503 "no healthy upstream".
# ---------------------------------------------------------------------------
FROM base AS prismacli
WORKDIR /pcli
RUN npm install --no-save --omit=optional prisma@6.19.3

# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migration tooling: the schema, the Prisma CLI and the generated client.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts* ./
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma
# Complete CLI tree, kept out of ./node_modules so it cannot shadow the
# standalone bundle's own copies.
COPY --from=prismacli /pcli/node_modules ./prisma-cli/node_modules

# `prisma migrate deploy` applies the committed migration history and refuses
# to act on drift. The previous script ran `prisma db push --accept-data-loss`,
# which skips migrations entirely and will drop columns and tables to force the
# live database to match the schema — on every container start.
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh

# Used by the scheduled automation service, which runs the same image with a
# different start command.
COPY --chown=nextjs:nodejs scripts/trigger-automation.mjs ./scripts/

USER nextjs

EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./docker-entrypoint.sh"]
