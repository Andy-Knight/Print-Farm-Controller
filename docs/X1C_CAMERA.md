# Experimental X1C camera

The X1 Carbon camera uses RTSPS/H.264. Controller packages now include a minimal,
source-built FFmpeg decoder that converts this feed to the existing JPEG previews
and MJPEG live view. No FFmpeg installation or environment variable is required
for normal Windows or container installations built from this branch. Physical
X1C acceptance remains required; this does not add other Bambu printer models.

## Normal setup

Configure the X1C host, LAN access code and camera port (normally 322) using the
existing printer settings. Enable local camera liveview on the printer as required
by its firmware. The controller constructs /streaming/live/1 at the configured
host and never follows printer-reported camera URLs.

The decoder is discovered at ffmpeg/bin/ffmpeg.exe beside the Windows controller,
or /app/ffmpeg/bin/ffmpeg inside the container. The Windows installer installs the
whole bundle in its protected program directory. Portable distributions must keep
the entire windows-x64 folder, including ffmpeg, rather than copying only the
controller executable. No additional browser configuration is required.

Kubernetes uses the normal controller image and existing data/log PVCs and
HTTP/HTTPS Service. No custom image or decoder volume is required. Use an image
built with this change (older published images do not contain it). The decoder
matches the image architecture, AMD64 or ARM64. Allow outbound TCP to the printer's
camera port; no extra inbound port, privileged container or GPU is required.

## Source development and advanced override

Run npm ci --include=dev, then build the local decoder with Docker running:

```text
npm run build:ffmpeg -- windows-x64
# Or linux-x64 / linux-arm64 for the corresponding development platform.
npm start
```

Windows SEA packaging builds/verifies the decoder automatically if the matching
build artifact is absent. CI cross-builds Windows FFmpeg on Linux and supplies
that verified artifact to the Windows job. Container builds compile their own
native decoder. Source builds require Docker/build tools; installed users do not.

An administrator may set PFC_FFMPEG_PATH to an absolute trusted executable path
to override the bundle, then restart. Relative overrides disable discovery rather
than being executed. There is no PATH or writable-data-directory search, and the
browser/printer cannot choose an executable. Without a discovered decoder the
X1C camera is disabled; P1/A1 Mini JPEG cameras do not need FFmpeg.

## Bundled source, licences and updates

The pinned FFmpeg source version, official URL and SHA-256 are in
scripts/ffmpeg-source.json. The verified unmodified source archive is vendored in
third-party/ffmpeg/source.tar.xz, avoiding upstream availability during builds.
The minimal build enables H.264 decoding, JPEG encoding, RTSP/TLS, fps and scale;
no GPL/nonfree components or libx264 encoder are enabled. Packaging fails if the
resulting FFmpeg licence is not LGPL or bundle integrity/source checks fail.
Windows uses Schannel and LGPL version 2.1 or later FFmpeg. Linux uses system
OpenSSL 3 and LGPL version 3 or later FFmpeg.

Each shipped ffmpeg/share/ffmpeg directory includes the matching source archive,
licence texts, notices, configure arguments, reproduction recipe, package-version
inventory and integrity manifest. Preserve and distribute those files with the
binary. Windows release signing covers both executables and records the signed
decoder checksum before installer compilation. The controller remains a separate
application communicating over standard pipes; its commercial licence does not
restrict users' rights to the bundled components.

For updates, review a patched upstream release, verify the official archive,
replace the source archive and manifest together, rebuild all targets and rerun
the real RTSPS fixture on the packaged binaries. Follow
[dependency policy](dependency-security.md). The LGPL configuration and included
source do not establish H.264 patent clearance; commercial distribution still
requires review of applicable patent/licence obligations. See
[FFmpeg licensing guidance](https://ffmpeg.org/legal.html).

## Operation and limits

- One decoder is shared by all viewers/snapshots for each active X1C camera and
  closes after the camera manager's existing idle timeout.
- Output is one JPEG per second, scaled to 960 pixels wide. Decode, encode and
  filter thread counts are limited. CPU/memory still depend on input and camera
  count; these are not hard memory limits. Measure fleet load and set pod limits.
- A bounded five-second executable capability probe accommodates FFmpeg TLS
  options. Startup/fresh-frame waits time out after ten seconds. Cached source
  frames older than 2.5 seconds require a new frame. Failures back off up to
  30 seconds; subsequent requests/polls retry, idle cameras do not reconnect.
  Existing camera-manager stale-JPEG fallback can remain visible briefly.
- Output framing is bounded to 4 MiB per JPEG. Oversized/stalled output and exit
  terminate the source. Shutdown awaits cleanup and force-kills after two seconds
  if normal termination is ignored.
- Camera TLS certificate verification is disabled for this LAN prototype to
  accommodate printer self-signed identities: encryption does not authenticate
  the printer certificate. Controller browser HTTPS and RBAC remain independent.
- FFmpeg stderr/raw spawn errors never enter public diagnostics because they may
  contain authenticated URLs. Privileged host users can inspect access codes in
  process arguments; protect host/process access.

## Validation

npm test automatically runs the real authenticated loopback RTSPS/RTP H.264 test
when the local bundled decoder exists, including rejected credentials and fresh
JPEG output. PFC_TEST_FFMPEG_PATH can select another decoder for that test. Source
checks also cover framing, bounded output, stale frames, backoff, cancellation,
termination and sharing. Packaging tests reject altered binary/source/recipe
checksums, missing notices, wrong targets and GPL/nonfree configurations.

The virtual X1C serves authenticated RTSPS/RTP H.264 at its existing camera port
(default 16020). It repeats a generated simulator image at five FPS with matching
RTP timing; the normal bundled decoder produces the existing previews/live view.
P1/A1 Mini virtual printers retain TLS/JPEG. Emulator tests exercise HTTP snapshots,
MJPEG, authentication, offline/camera faults and decoder idle cleanup. Browser CI
also requires an actual decoded image in the X1C camera tab.

Physical acceptance must cover firmware settings, disconnects,
multiple viewers, snapshots, idle/shutdown cleanup and resource usage on Windows
and Kubernetes. Signed production publication remains a separate release gate.
