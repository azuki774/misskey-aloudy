# syntax=docker/dockerfile:1.7
ARG NODE_BASE_DIGEST=sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203

FROM node:24-slim@${NODE_BASE_DIGEST} AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
    && pnpm install --frozen-lockfile

FROM node:24-slim@${NODE_BASE_DIGEST} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable \
    && pnpm run build

FROM node:24-slim@${NODE_BASE_DIGEST} AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=builder --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server/entry.mjs"]
