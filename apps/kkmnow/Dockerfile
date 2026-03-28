# ── Stage 1: Install dependencies ──────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy workspace package manifests for deterministic install
COPY package.json yarn.lock turbo.json ./
COPY apps/kkmnow/package.json ./apps/kkmnow/
COPY packages/datagovmy-ui/package.json ./packages/datagovmy-ui/
COPY packages/datagovmy-nextra/package.json ./packages/datagovmy-nextra/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config-datagovmy/package.json ./packages/eslint-config-datagovmy/

RUN yarn install --frozen-lockfile --network-timeout 600000

# ── Stage 2: Build the application ────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/kkmnow/node_modules ./apps/kkmnow/node_modules
COPY --from=deps /app/packages/datagovmy-ui/node_modules ./packages/datagovmy-ui/node_modules
COPY --from=deps /app/packages/datagovmy-nextra/node_modules ./packages/datagovmy-nextra/node_modules

# Copy full source
COPY . .

# Build-time env vars (NEXT_PUBLIC_* are baked into the JS bundle)
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_S3_URL
ARG NEXT_PUBLIC_APP_ENV
ARG NEXT_PUBLIC_API_KEY
ARG NEXT_PUBLIC_AUTHORIZATION_TOKEN
ARG NEXT_PUBLIC_GA_TAG
ARG NEXT_PUBLIC_MIXPANEL_TOKEN
ARG NEXT_PUBLIC_TINYBIRD_TOKEN
ARG NEXT_PUBLIC_TINYBIRD_URL
ARG NEXT_PUBLIC_TILESERVER_URL
ARG NEXT_PUBLIC_I18N_URL

ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_S3_URL=$NEXT_PUBLIC_S3_URL \
    NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV \
    NEXT_PUBLIC_API_KEY=$NEXT_PUBLIC_API_KEY \
    NEXT_PUBLIC_AUTHORIZATION_TOKEN=$NEXT_PUBLIC_AUTHORIZATION_TOKEN \
    NEXT_PUBLIC_GA_TAG=$NEXT_PUBLIC_GA_TAG \
    NEXT_PUBLIC_MIXPANEL_TOKEN=$NEXT_PUBLIC_MIXPANEL_TOKEN \
    NEXT_PUBLIC_TINYBIRD_TOKEN=$NEXT_PUBLIC_TINYBIRD_TOKEN \
    NEXT_PUBLIC_TINYBIRD_URL=$NEXT_PUBLIC_TINYBIRD_URL \
    NEXT_PUBLIC_TILESERVER_URL=$NEXT_PUBLIC_TILESERVER_URL \
    NEXT_PUBLIC_I18N_URL=$NEXT_PUBLIC_I18N_URL

RUN npx turbo run build --filter=kkmnow

# ── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output (preserves monorepo structure)
COPY --from=builder --chown=nextjs:nodejs /app/apps/kkmnow/.next/standalone ./
# Copy static assets (not included in standalone output)
COPY --from=builder --chown=nextjs:nodejs /app/apps/kkmnow/.next/static ./apps/kkmnow/.next/static
# Copy public directory
COPY --from=builder --chown=nextjs:nodejs /app/apps/kkmnow/public ./apps/kkmnow/public

USER nextjs

EXPOSE 3000

CMD ["node", "apps/kkmnow/server.js"]
