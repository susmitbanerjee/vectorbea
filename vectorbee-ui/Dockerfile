# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json ./
COPY package-lock.json* yarn.lock* ./

RUN set -eux; \
    if [ -f package-lock.json ]; then npm ci; \
    elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    else echo "No lockfile found. Expected package-lock.json or yarn.lock" && exit 1; \
    fi

FROM node:22-alpine AS builder

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN set -eux; \
    if [ -f package-lock.json ]; then npm run build; \
    elif [ -f yarn.lock ]; then yarn build; \
    else echo "No lockfile found. Expected package-lock.json or yarn.lock" && exit 1; \
    fi

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs

EXPOSE 3000

ENTRYPOINT ["node", "server.js"]
