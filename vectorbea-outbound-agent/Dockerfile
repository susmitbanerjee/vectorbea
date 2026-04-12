# syntax=docker/dockerfile:1

FROM node:18-alpine AS deps
WORKDIR /app

COPY package.json ./
RUN npm install

FROM node:18-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json index.ts ./
RUN npm run build
RUN npm prune --omit=dev

FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV POLL_INTERVAL_MS=15000

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

CMD ["node", "dist/index.js"]
