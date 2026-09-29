# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --include=dev --no-audit --no-fund

COPY scripts ./scripts
COPY src ./src
COPY emulator ./emulator

ARG PFC_BUNDLE_BUILD_NONCE=local
RUN --mount=type=secret,id=pfc_google_client_id,required=false \
    --mount=type=secret,id=pfc_google_client_secret,required=false \
    PFC_GOOGLE_CLIENT_ID="$(if [ -f /run/secrets/pfc_google_client_id ]; then cat /run/secrets/pfc_google_client_id; fi)" \
    PFC_GOOGLE_CLIENT_SECRET="$(if [ -f /run/secrets/pfc_google_client_secret ]; then cat /run/secrets/pfc_google_client_secret; fi)" \
    PFC_BUNDLE_BUILD_NONCE="$PFC_BUNDLE_BUILD_NONCE" \
    npm run build:bundle

FROM node:24-bookworm-slim

WORKDIR /app

LABEL org.opencontainers.image.source="https://github.com/Andy-Knight/Print-Farm-Controller"
LABEL org.opencontainers.image.title="Print Farm Controller"
LABEL org.opencontainers.image.description="Local-first multi-printer fleet controller"

COPY package.json ./
COPY src ./src
COPY public ./public
COPY emulator ./emulator
COPY --from=builder /app/build/controller.cjs ./build/controller.cjs

RUN mkdir -p /data /logs \
    && chown -R node:node /data /logs

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4242
ENV DATA_DIR=/data
ENV LOG_DIR=/logs
ENV DISCOVERY_SUBNET=""

USER node

EXPOSE 4242

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4242/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build/controller.cjs"]
