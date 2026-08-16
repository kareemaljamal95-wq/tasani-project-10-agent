FROM node:20-alpine AS base

RUN apk add --no-cache openssl

FROM base AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --only=production

FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma

# سكريبت بدء التشغيل - يشغّل ترحيل Prisma ثم يطلق السيرفر
RUN echo '#!/bin/sh\nnpx prisma db push --accept-data-loss --skip-generate\nnode server.js' > /app/start.sh && chmod +x /app/start.sh

USER nextjs

EXPOSE 8080
ENV PORT=8080

CMD ["/bin/sh", "/app/start.sh"]
