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
COPY --from=deps /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps /app/node_modules/.bin ./node_modules/.bin

# `prisma migrate deploy` applies the committed migration history and refuses
# to act on drift. The previous script ran `prisma db push --accept-data-loss`,
# which skips migrations entirely and will drop columns and tables to force the
# live database to match the schema — on every container start.
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./docker-entrypoint.sh"]
