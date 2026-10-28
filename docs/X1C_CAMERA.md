# Experimental X1C camera prototype

The X1 Carbon camera uses RTSPS/H.264, unlike the JPEG-over-TLS camera used by
P1P, P1S and A1 Mini. The controller can run an **external FFmpeg executable** to
convert X1C video into its existing JPEG snapshots and MJPEG browser stream.
Physical X1C, Windows decoder and Kubernetes acceptance remain required. This
prototype does not add support for other Bambu models.

## Configure the decoder

Set `PFC_FFMPEG_PATH` to an absolute path to a trusted FFmpeg executable, then
restart the controller. The path is host/deployment configuration, never a
printer field or browser-supplied value. Relative paths and PATH lookup are not
accepted. Without this setting X1C camera capability remains disabled; existing
P1/A1 Mini cameras work as before.

FFmpeg must support RTSPS with TLS, RTSP-over-TCP, H.264 decoding, the `fps` and
`scale` filters, JPEG encoding and `image2pipe`. Enable local camera liveview on
the printer as required by its firmware. Configure the printer IP/DNS hostname,
LAN access code and camera port (normally 322) in the existing printer settings.
The controller constructs `/streaming/live/1` at that host; it does not follow
printer-reported camera URLs.

### Windows source and portable executable

Use a trusted decoder installation with all its required DLLs. For example:

```powershell
$env:PFC_FFMPEG_PATH = 'C:\Tools\FFmpeg\bin\ffmpeg.exe'
npm start
# Or launch the portable PrintFarmController.exe from this same environment.
```

For an installed controller, provide the variable in its launch environment and
restart it. The current installer does not install FFmpeg. Keep the decoder and
its libraries in a protected program directory, separate from writable data and
logs. No console window is opened for decoder processes.

### Containers and Kubernetes

The stock controller image does not include FFmpeg. Use a deployment-owned image
containing a reviewed decoder and its runtime libraries, or a read-only mounted
decoder installation compatible with the container's Linux ABI. Set, for example:

```yaml
env:
  - name: PFC_FFMPEG_PATH
    value: /opt/ffmpeg/bin/ffmpeg
```

The path must exist **inside the controller container**, be executable by its
non-root user, and match the node architecture (AMD64 or ARM64). A Windows binary
cannot be reused in a Linux container. Allow outbound TCP to the printer camera
port; the prototype does not open an additional listening port or require a GPU,
privileged container or changes to the existing HTTP/HTTPS Service.

## Operation and limits

- One decoder is shared by all viewers and dashboard snapshots for each active
  X1C camera. The camera manager closes it after its existing idle timeout.
- Output is one JPEG per second, scaled to 960 pixels wide. Decode and encode
  thread counts are limited to one each; CPU/memory still depend on the input
  stream and the number of cameras. These options are not a hard process memory
  limit. Set container resource limits and measure the intended fleet size.
- Startup and fresh-frame waits time out after ten seconds. Cached source frames
  older than 2.5 seconds require a new frame. Failures trigger reconnect backoff
  up to 30 seconds; retries happen on subsequent camera requests/polls, not while
  idle. The camera manager may serve its existing short-lived stale JPEG fallback.
- Output framing is bounded to 4 MiB per JPEG. Oversized output, decoder exit and
  frame timeout terminate the source. Shutdown waits for decoder cleanup, with
  forced termination after two seconds if normal termination is ignored.
- Printer camera TLS certificate verification is disabled for this LAN-only
  prototype to accommodate printer self-signed identities. It encrypts the link
  but does not authenticate the printer certificate. Controller browser HTTPS
  and RBAC remain independent and continue to protect camera routes.
- FFmpeg stderr and raw spawn errors are not exposed to browser/API diagnostics,
  because they may contain the authenticated camera URL. The access code is in
  the decoder process arguments and can be inspected by privileged host users;
  protect host/process access accordingly.

## Decoder distribution

No decoder binary or new npm dependency is shipped by this prototype. Selecting
an external decoder does not establish licence or patent clearance. Before
commercial redistribution, review the exact FFmpeg build, enabled components,
licence notices, corresponding source/build records and H.264 patent position.
Prefer a reviewed LGPL build without GPL/nonfree components; H.264 decoding and
JPEG encoding do not require the optional libx264 H.264 encoder. See
[FFmpeg licensing guidance](https://ffmpeg.org/legal.html) and the repository's
[dependency policy](dependency-security.md).

## Validation

`npm test` exercises framing, credential-safe failures, shared startup, stale
frames, buffer limits, reconnect backoff, termination escalation and camera-manager
integration using controlled subprocess doubles.

For a real decoder test, set an absolute `PFC_TEST_FFMPEG_PATH` and run:

```text
node --test test/bambu-x1c-camera-integration.test.js
```

This starts a loopback TLS RTSP server with authentication and RTP-interleaved
synthetic H.264 video, then requires real FFmpeg JPEG output and continued fresh
frames. The tiny fixture is generated solid-blue footage, not printer/customer
video. The test skips when no external decoder is selected. The existing X1C
emulator camera remains a TLS/JPEG test endpoint and cannot validate this feature.
Real printer acceptance must include LAN authentication/firmware settings,
disconnect/reconnect, multiple viewers, snapshots, idle/shutdown cleanup,
credential handling and CPU/memory on Windows and Kubernetes.
