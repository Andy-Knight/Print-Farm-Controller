# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM debian:bookworm-slim AS decoder
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils make gcc libc6-dev pkg-config jq libssl-dev \
    && if [ "$TARGETARCH" = arm64 ] && [ "$(uname -m)" != aarch64 ]; then \
         dpkg --add-architecture arm64 && apt-get update \
           && apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross libssl-dev:arm64; \
       fi \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/ffmpeg-source.json scripts/ffmpeg-build.sh /build-input/
COPY third-party/ffmpeg/source.tar.xz /build-input/source.tar.xz
RUN if [ "$TARGETARCH" = arm64 ] && [ "$(uname -m)" != aarch64 ]; then target=linux-arm64; else target=linux; fi \
    && sh /build-input/ffmpeg-build.sh "$target" /opt/pfc-ffmpeg

FROM node:24.22.1-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY scripts ./scripts
COPY public ./public
COPY ui ./ui
RUN npm install --global npm@12.2.0 --no-audit --no-fund \
    && npm ci --include=dev --no-audit --no-fund

COPY src ./src
COPY emulator ./emulator

ARG PFC_BUNDLE_BUILD_NONCE=local
RUN --mount=type=secret,id=pfc_google_client_id,required=false \
    --mount=type=secret,id=pfc_google_client_secret,required=false \
    --mount=type=secret,id=pfc_microsoft_client_id,required=false \
    PFC_GOOGLE_CLIENT_ID="$(if [ -f /run/secrets/pfc_google_client_id ]; then cat /run/secrets/pfc_google_client_id; fi)" \
    PFC_GOOGLE_CLIENT_SECRET="$(if [ -f /run/secrets/pfc_google_client_secret ]; then cat /run/secrets/pfc_google_client_secret; fi)" \
    PFC_MICROSOFT_CLIENT_ID="$(if [ -f /run/secrets/pfc_microsoft_client_id ]; then cat /run/secrets/pfc_microsoft_client_id; fi)" \
    PFC_BUNDLE_BUILD_NONCE="$PFC_BUNDLE_BUILD_NONCE" \
    npm run build:bundle

FROM node:24.22.1-bookworm-slim

WORKDIR /app

LABEL org.opencontainers.image.source="https://github.com/Andy-Knight/Print-Farm-Controller"
LABEL org.opencontainers.image.title="Print Farm Controller"
LABEL org.opencontainers.image.description="Local-first multi-printer fleet controller"

COPY package.json ./
COPY src ./src
COPY --from=builder /app/public ./public
COPY emulator ./emulator
COPY --from=builder /app/build/controller.cjs ./build/controller.cjs
COPY --from=decoder /opt/pfc-ffmpeg ./ffmpeg

RUN apt-get update && apt-get install -y --no-install-recommends libssl3 \
    && rm -rf /var/lib/apt/lists/* \
    && /app/ffmpeg/bin/ffmpeg -version \
    && mkdir -p /data /logs \
    && chown -R node:node /data /logs

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4242
ENV DATA_DIR=/data
ENV LOG_DIR=/logs
ENV DISCOVERY_SUBNET=""

USER node

EXPOSE 4242 4243

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4242/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build/controller.cjs"]
