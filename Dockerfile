# syntax=docker/dockerfile:1.7
FROM node:24-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS build-base

FROM build-base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
    && pnpm install --frozen-lockfile

FROM build-base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable \
    && pnpm run build \
    && pnpm prune --prod --ignore-scripts

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:633e1463f02b25e50109325c59cfd373f404169085851b6cd2951bde1aca5623 AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=builder --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /app/dist        ./dist
USER nonroot
EXPOSE 3000
CMD ["dist/server/entry.mjs"]
