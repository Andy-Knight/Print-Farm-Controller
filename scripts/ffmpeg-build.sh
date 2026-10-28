#!/bin/sh
set -eu

# This recipe is also shipped with the unmodified corresponding source archive.
target=${1:-linux}
prefix=${2:-/opt/pfc-ffmpeg}
inputs=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
version=$(jq -er .version "$inputs/ffmpeg-source.json")
url=$(jq -er .url "$inputs/ffmpeg-source.json")
sha=$(jq -er .sha256 "$inputs/ffmpeg-source.json")
mkdir -p /tmp/pfc-ffmpeg-build "$prefix/bin" "$prefix/share/ffmpeg"
cd /tmp/pfc-ffmpeg-build
archive="ffmpeg-$version.tar.xz"
if [ -f "$inputs/source.tar.xz" ]; then
  cp "$inputs/source.tar.xz" "$archive"
elif [ -f "$inputs/$archive" ]; then
  cp "$inputs/$archive" "$archive"
else
  curl --fail --location --retry 3 --retry-all-errors --output "$archive" "$url"
fi
printf '%s  %s\n' "$sha" "$archive" | sha256sum --check -
tar -xf "$archive"
cd "ffmpeg-$version"

set -- --prefix="$prefix" --disable-autodetect --disable-everything \
  --disable-doc --disable-debug --disable-x86asm --disable-shared --enable-static \
  --disable-ffplay --disable-ffprobe --enable-ffmpeg --enable-network \
  --enable-protocol=file,pipe,tcp,tls --enable-demuxer=rtsp,rtp,sdp,h264 \
  --enable-parser=h264 --enable-decoder=h264 --enable-encoder=mjpeg \
  --enable-filter=fps,scale,format --enable-muxer=image2pipe --enable-swscale

case "$target" in
  windows-x64)
    set -- "$@" --enable-cross-compile --cross-prefix=x86_64-w64-mingw32- \
      --target-os=mingw32 --arch=x86_64 --enable-schannel \
      --disable-pthreads --enable-w32threads --extra-ldflags=-static
    binary=ffmpeg.exe
    ;;
  linux|linux-arm64)
    set -- "$@" --enable-openssl --enable-version3
    if [ "$target" = linux-arm64 ]; then
      export PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig
      set -- "$@" --enable-cross-compile --cross-prefix=aarch64-linux-gnu- \
        --target-os=linux --arch=aarch64 --pkg-config=pkg-config \
        --extra-cflags=-I/usr/include/aarch64-linux-gnu \
        --extra-ldflags=-L/usr/lib/aarch64-linux-gnu
    fi
    target=linux
    binary=ffmpeg
    ;;
  *) echo 'Unsupported decoder build target' >&2; exit 1 ;;
esac

printf '%s\n' "$@" > "$prefix/share/ffmpeg/configure-arguments.txt"
./configure "$@" || { tail -n 80 ffbuild/config.log; exit 1; }
# Fail closed if a future change enables GPL/non-redistributable components.
grep '^#define FFMPEG_LICENSE "LGPL version' config.h
make -j2
make install-progs
cp COPYING* LICENSE.md "$prefix/share/ffmpeg/"
cp "../$archive" "$prefix/share/ffmpeg/"
cp "$inputs/ffmpeg-source.json" "$inputs/ffmpeg-build.sh" "$prefix/share/ffmpeg/"
cp config.h ffbuild/config.mak "$prefix/share/ffmpeg/"
dpkg-query -W > "$prefix/share/ffmpeg/build-packages.txt"
printf '%s\n' 'This product includes a separate FFmpeg executable.' \
  'Copyright FFmpeg contributors. See LICENSE.md and COPYING* for its licence.' \
  'The unmodified corresponding source, exact configure arguments and build recipe are included here.' \
  'Upstream: https://ffmpeg.org/ . No GPL or nonfree components are enabled.' \
  'Linux uses system OpenSSL 3 with LGPL version 3 or later FFmpeg; Windows uses Schannel with LGPL version 2.1 or later FFmpeg.' \
  'The controller licence does not restrict your rights to these third-party components.' \
  > "$prefix/share/ffmpeg/NOTICE.txt"
if [ "$target" = linux ]; then
  cp /usr/share/doc/libssl-dev/copyright "$prefix/share/ffmpeg/OpenSSL-copyright.txt"
else
  for entry in /usr/share/doc/mingw-w64*/copyright /usr/share/doc/gcc-mingw-w64*/copyright; do
    [ -f "$entry" ] || continue
    package=$(basename "$(dirname "$entry")")
    cp "$entry" "$prefix/share/ffmpeg/$package-copyright.txt"
  done
fi
binary_sha=$(sha256sum "$prefix/bin/$binary" | cut -d ' ' -f1)
recipe_sha=$(sha256sum "$inputs/ffmpeg-build.sh" | cut -d ' ' -f1)
jq --arg binary "$binary" --arg hash "$binary_sha" --arg target "$target" --arg recipe "$recipe_sha" \
  '. + {binary:$binary,binarySha256:$hash,target:$target,recipeSha256:$recipe}' \
  "$inputs/ffmpeg-source.json" > "$prefix/share/ffmpeg/manifest.json"
