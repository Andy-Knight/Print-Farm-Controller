# syntax=docker/dockerfile:1.7
FROM --platform=$BUILDPLATFORM debian:bookworm-slim AS decoder
ARG DECODER_TARGET=linux
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils make gcc libc6-dev pkg-config jq libssl-dev nasm \
    && if [ "$DECODER_TARGET" = windows-x64 ]; then \
         apt-get install -y --no-install-recommends gcc-mingw-w64-x86-64; \
       elif [ "$DECODER_TARGET" = linux-arm64 ]; then \
         dpkg --add-architecture arm64 && apt-get update \
           && apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross libssl-dev:arm64; \
       fi \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/ffmpeg-source.json scripts/ffmpeg-build.sh /build-input/
COPY third-party/ffmpeg/source.tar.xz /build-input/source.tar.xz
RUN sh /build-input/ffmpeg-build.sh "$DECODER_TARGET" /opt/pfc-ffmpeg
FROM scratch AS export
COPY --from=decoder /opt/pfc-ffmpeg/ /
