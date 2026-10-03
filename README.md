# Print Farm Controller v0.39.0

**Current release: v0.39.0**

Current highlights:

- Stacked Layers header branding prototype with responsive Light/Dark treatment; the existing embedded favicon is unchanged.

- Container images for Linux AMD64 and ARM64, with Docker and K3s/Kubernetes deployment guidance.
- Persistent Print Library, smart queueing, printer groups and maintenance tracking.
- Reports & analytics with graphical trends, printer reliability indicators, popular-file reporting, filament usage and material-cost tracking.
- Filament catalogue costing with Orca/Bambu slicer vendor/preset auto-matching, explicit per-tool overrides, immutable historical cost snapshots, and a controlled selector covering common world currencies.
- Compressed portable backup and restore, including local/NAS, Google Drive, Microsoft OneDrive and generic S3-compatible destinations, multi-group printer membership, reporting history/filament catalogue data, and backwards-compatible restore of older backups.
- Snapmaker U1, FlashForge and Prusa CORE One+ support, with experimental Bambu Lab support.
- Offline signed licensing with Community, Pro and Farm editions.

For the complete version history, see [CHANGELOG.md](CHANGELOG.md).

A local-first 3D printer fleet controller. It runs entirely on your LAN and currently supports:

- **FlashForge Adventurer 5M / 5M Pro** through the local FlashForge HTTP/TCP APIs.
- **FlashForge Creator 5 / Creator 5 Pro** through the supported local FlashForge control interfaces.
- **Snapmaker U1** through its local Moonraker/Klipper API.
- **Prusa CORE One+** through its built-in local PrusaLink HTTP API. v0.39.0 supports the standard 1-tool configuration plus **INDX 4-tool and 8-tool upgrades**. INDX uses fixed sliced tool indices (T0→T0, T1→T1, etc.); the controller validates per-tool material/nozzle state when PrusaLink exposes it and does not silently remap a sliced tool to another physical tool. Existing CORE One+ entries can be changed between Standard, INDX 4 and INDX 8 from printer details after a hardware upgrade. The integration also supports live status, printer-local file browsing, G-code/BGCODE upload and verification, print start, and pause/resume/cancel. PrusaLink credentials stay backend-side. The integrated Printer Simulator includes Standard, INDX 4 and INDX 8 CORE One+ profiles for repeatable controller testing. Temperature/chamber/camera control are intentionally not exposed until supported local interfaces are validated on hardware.

Prusa support is implemented as a reusable **PrusaLink family layer**. Shared authentication, status, files, upload, verification and job-control behaviour lives outside individual printer models. Each supported Prusa model supplies a compact model profile containing its adapter ID, limits, valid tool configurations and capability differences; PrusaLink model profiles are registered automatically. This keeps future Prusa additions isolated to model metadata, simulator/artwork and hardware-specific validation unless their firmware genuinely differs from the shared PrusaLink API.
- **Bambu Lab P1P / P1S / X1C / A1 Mini (experimental)** through the local MQTT TLS and FTPS TLS interfaces. P1P/P1S/A1 Mini use the TLS/JPEG camera path; X1C camera decoding remains unsupported.

The application is named **Print Farm Controller**. The default application-data directory retains its historical **Printer Fleet Controller** / `printer-fleet-controller` folder name for compatibility; existing installations therefore continue to use the same configured printers, queued work and settings after the v0.14.9 branding rename.

## Licensing

Print Farm Controller uses offline Ed25519-signed licence files. The controller contains trusted **public** verification keys only; private signing keys are never required by the controller.

If no valid signed licence is installed, the controller runs as **Community Edition**.

| Edition | Physical printers | Notes |
| --- | ---: | --- |
| Community | 3 | Default when no valid licence is installed |
| Pro | 10 | Signed Pro licence |
| Farm | 25 | Signed Farm licence |
| Development | Unlimited | Internal development mode only; not enabled by normal production startup |

Simulator printers do **not** consume physical-printer licence slots.

If an installed licence allows fewer physical printers than are already configured, the controller does not delete or forget any printer. All configured printers remain visible and saved; the permitted number can be selected as active licence slots.

### Licence file

The signed licence is always stored in the controller data directory:

```text
<DATA_DIR>/license.json
```

With the default application-local data directory this is `<controller application directory>/data/license.json` in both source/development and packaged SEA modes. A valid previous application-root `license.json` is accepted once for migration: the controller verifies it, copies it into the data directory, and removes the old copy after a successful migration. Invalid or tampered legacy licences are not promoted. A custom `DATA_DIR` therefore also determines the persistent licence location.

A licence contains signed customer/licence metadata such as:

- licence ID
- customer
- edition
- maximum physical printers
- perpetual or subscription type
- issue/expiry/update dates
- optional additional feature entitlements
- signing key ID

Changing any signed field invalidates the signature.

### Installing or replacing a licence

Use the controller's **Licence** interface to install or replace a signed licence generated by the private Print Farm Licensing application.

The controller validates the file before accepting it. A valid replacement is reloaded immediately; a controller restart is not required.

The current production signing-key ID is:

```text
primary-2026
```

Only public keys embedded in the controller's trusted-key list can verify production licences. When rotating to a new signing key, the new **public** key must first be added to the controller and released before licences are issued with that key. Existing trusted public keys should remain present while licences signed by them still need to be supported.

### Production hardening

Normal production startup deliberately ignores licence-bypass environment variables:

- `PRINT_CONTROLLER_EDITION` cannot elevate Community to Pro, Farm or Development.
- `PRINT_CONTROLLER_LICENSE_PUBLIC_KEY_FILE` cannot make production trust an arbitrary verification key.
- `PRINT_CONTROLLER_LICENSE_KEY_ID` is only relevant inside the explicitly gated internal development override path.

An invalid, tampered or untrusted licence fails closed to Community Edition. An expired subscription licence also falls back to Community while retaining its licence identity for status/display purposes.

The internal `allowDevelopmentOverrides:true` loader option exists for tests/development code only and is not enabled by the production server.

## Run

Requires Node.js 24 or later. Development has been performed against Node.js 24.21.0. There are no npm runtime dependencies.
To run from the source files launch with the following commands from the command line, making sure npm is available.

```bash
npm start
```

## Reports and material costs

Print Farm Controller v0.37.0 adds a persistent **Reports & analytics** view for operational and material-cost reporting. The reporting history is stored independently of the bounded recent queue history so long-term trends are retained.

Reports can be filtered by date range, printer and printer group and include:

- completed, failed and cancelled print counts and rates;
- printer run hours and transparent printer failure-rate trends;
- most frequently printed files;
- filament usage by material/catalogue entry;
- estimated material spend by currency.

Material costing uses sliced filament usage in grams from supported G-code and embedded 3MF plate G-code. The controller-owned filament catalogue stores material, optional brand/product/colour, currency and cost per kg.

For each logical slicer tool, cost resolution uses the following precedence:

1. an explicit Print Library filament assignment;
2. an unambiguous Orca/Bambu slicer vendor/preset match using metadata such as `filament_vendor` and `filament_settings_id`;
3. a unique material-only catalogue match;
4. explicit user selection when more than one plausible catalogue filament remains.

The controller does not guess between ambiguous same-material/same-brand entries. When a print starts, the applicable grams, catalogue identity, price/kg and estimated cost are snapshotted into the print record. Later catalogue price changes therefore do not rewrite historical print costs.

The filament catalogue, reporting history, Print Library metadata (including filament assignments and detected slicer profile metadata), Print Library files and print-job history are included in portable `.pfcbackup` archives. Older backups that predate these stores restore with compatible empty defaults, and older Print Library entries can be lazily reparsed from their restored source files where supported.

## Google Drive backups

Print Farm Controller can upload the same verified, compressed `.pfcbackup` files used by local backup/recovery directly to Google Drive. Manual and scheduled Google Drive backups use the existing backup engine; Google Drive is only a storage destination.

Google Drive integration uses Google's **TVs and Limited Input devices** OAuth client flow and requests only:

```text
https://www.googleapis.com/auth/drive.file
```

This limits the controller to files and folders it creates or has been granted access to rather than giving it unrestricted access to the whole Drive.

### Production OAuth configuration

Released Print Farm Controller builds are intended to use one shared **Print Farm Controller** Google OAuth client. End users do not need to create a Google Cloud project or enter a client ID/secret: they open **Backup & recovery → Google Drive**, select **Connect**, and authorize their own Google account.

The production OAuth credentials are injected at build time and are not committed to the repository:

- GitHub Actions repository secrets: `PFC_GOOGLE_CLIENT_ID` and `PFC_GOOGLE_CLIENT_SECRET`.
- Published GHCR builds receive those values through Docker BuildKit secret mounts only on non-pull-request production builds.
- The Windows SEA bundle builder reads the same `PFC_GOOGLE_CLIENT_ID` / `PFC_GOOGLE_CLIENT_SECRET` environment variables when producing an executable or installer.
- The resulting production bundle contains the distributed OAuth client credentials. They must therefore be treated as extractable application credentials, not as a security boundary. Customer Drive access still requires that customer's own OAuth authorization/refresh token.

Pull-request container builds deliberately do **not** receive the production OAuth secrets. A per-run build nonce also prevents a cached production bundle containing credentials from being reused by a non-production build.

For source/development builds or installations that deliberately want their own Google project, **Advanced OAuth configuration** allows a custom OAuth client ID/secret. Runtime `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET` remain supported as deployment-level overrides. Credential precedence is:

1. custom credentials saved in the controller UI;
2. runtime `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET`;
3. built-in production credentials;
4. unconfigured.

Selecting **Use default configuration** clears a saved custom OAuth client and its account authorization, then returns to the deployment/built-in application credentials. The Google account must be connected again because refresh tokens are tied to the OAuth client.

### Credential storage

The customer's long-lived refresh token, managed Drive folder ID, and any deliberately saved **custom** OAuth client credentials are stored in:

```text
<DATA_DIR>/integrations/google-drive.json
```

Built-in production OAuth credentials are not copied into this file. The file is written with restrictive permissions inside the persistent controller data directory. The short-lived access token remains memory-only. Custom client secrets and refresh tokens are never returned by the status API, are never shown again in the UI after saving, and the entire integration file is deliberately excluded from `.pfcbackup` archives and diagnostic logging.

Protect the controller data directory/PVC because the stored OAuth credentials can authorize future Drive access. Google Drive also requires outbound HTTPS access to Google's OAuth and Drive API endpoints.

### Backup behavior

Cloud restore is provider-based rather than Google-specific. Google Drive, Microsoft OneDrive and S3-compatible storage are registered providers; additional providers can implement the same list/download interface without changing the restore engine.

- **Backup to Google Drive now** creates, verifies and compresses the canonical backup before uploading it.
- Scheduled backups can select **Google Drive** instead of a local/mapped/NAS folder.
- Retention deletes only older **scheduled** Drive backups created by the same controller installation. Manual Drive backups and backups from another installation are left untouched.
- **Disconnect** revokes/removes the Google account authorization while retaining the selected OAuth configuration. With a production build, reconnecting normally requires only another Google authorization.
- Saving a custom OAuth client or switching back to the default configuration clears the existing Google account authorization when the OAuth client changes because refresh tokens are client-specific.
- If Google invalidates/revokes the refresh token, the controller reports **Reconnection required** instead of silently dropping scheduled backups.
- Restore can use either a local `.pfcbackup` file or a backup selected directly from a connected cloud provider. Google Drive backups are listed in the restore source selector, downloaded to temporary staging, and passed through the same inspection, checksum/version validation, recovery-hold and restart-based restore pipeline as local files.


## Microsoft OneDrive backups (Experimental)

Print Farm Controller v0.36.0 includes Microsoft OneDrive as an **experimental** cloud backup and restore provider. Automated tests and packaging validation are complete, but the integration has not yet been validated against a live Microsoft account. Manual and scheduled OneDrive backups use the same verified/compressed `.pfcbackup` format and the same restore inspection/staging engine as local and Google Drive backups.

OneDrive authorization uses Microsoft's device-code OAuth flow and requests:

```text
offline_access Files.ReadWrite.AppFolder
```

This limits Print Farm Controller to its dedicated OneDrive application folder and provides a refresh token for scheduled backups. The integration is a public-client flow, so **no Microsoft client secret is required**.

Released builds can embed the shared Print Farm Controller Microsoft application client ID from `PFC_MICROSOFT_CLIENT_ID`. Production container builds receive that value through the GitHub Actions repository secret of the same name using a BuildKit secret mount. Source/development installations can instead use **Backup & recovery → Microsoft OneDrive → Advanced OAuth configuration** to enter a custom application client ID. Runtime `ONEDRIVE_CLIENT_ID` or `MICROSOFT_ONEDRIVE_CLIENT_ID` can also supply a deployment-specific client ID.

The customer authorization state is stored in:

```text
<DATA_DIR>/integrations/one-drive.json
```

Built-in client IDs are not copied into this file. The saved refresh token and integration state are excluded from `.pfcbackup` archives and diagnostics.

OneDrive stores controller backups in the Microsoft Graph `approot` application folder. Each uploaded backup has a small companion `.pfcmeta.json` item containing PFC ownership/retention metadata only. This lets scheduled retention safely remove only older scheduled backups belonging to the same controller installation while leaving manual and foreign-installation backups untouched.

- **Backup to OneDrive now** creates and verifies the canonical backup before uploading it.
- Scheduled backups can select **Microsoft OneDrive (Experimental)**.
- Connected OneDrive appears automatically as a cloud restore source.
- Cloud restore downloads the selected backup to temporary staging and then uses the same inspection, checksum/version validation, recovery-hold, staged restart and rollback path as local/Google Drive restore.
- Disconnecting removes the controller's stored Microsoft account authorization but leaves existing OneDrive backup files untouched.

## S3-compatible backups

Print Farm Controller v0.35.0 can use generic S3-compatible object storage for manual backups, scheduled backups with retention, and direct cloud restore. The implementation uses the standard S3 REST API and AWS Signature Version 4 without adding an AWS SDK or any other runtime npm dependency.

The S3 configuration in **Backup & recovery → S3-compatible storage** contains:

- endpoint URL, for example `https://s3.example.com` or a local MinIO endpoint;
- bucket name;
- region, defaulting to `us-east-1`;
- access key ID and secret access key;
- optional object-key prefix, defaulting to `print-farm-controller/`;
- path-style or virtual-hosted addressing.

HTTPS is required by default. **Allow insecure HTTP** exists only for trusted local development services such as a MinIO instance on the LAN.

S3 credentials are stored with restrictive permissions in:

```text
<DATA_DIR>/integrations/s3.json
```

The secret access key is never returned by the status API and the entire integration file is excluded from portable `.pfcbackup` archives and diagnostics. Protect the controller data directory/PVC because the saved credentials can authorize access to the configured bucket.

PFC writes the canonical verified/compressed `.pfcbackup` unchanged. Each backup also receives a small adjacent `.pfcmeta.json` sidecar containing only backup ownership/retention metadata. This allows scheduled retention to delete only older scheduled backups created by the same controller installation; manual backups and backups owned by another installation are never pruned automatically.

The implementation deliberately uses a common S3 subset—bucket access, `PutObject`, `ListObjectsV2`, `GetObject` and `DeleteObject`—so it is suitable for services such as MinIO, Amazon S3, Cloudflare R2, Backblaze B2, Wasabi and other compatible systems. Provider-specific features such as ACLs, object tagging and IAM-role discovery are not required.

Connected S3-compatible storage appears automatically in the cloud restore selector. Restore downloads the selected object to temporary local staging and then uses the same inspection, checksum/version validation, recovery-hold, staged restart and rollback engine as local and Google Drive backups.

## Docker

### Published container image

The production container is published to GitHub Container Registry as a multi-architecture image for:

- `linux/amd64`
- `linux/arm64`

Pull the current release image:

```bash
docker pull ghcr.io/andy-knight/print-farm-controller:latest
```

Run it with portable named volumes:

```bash
docker run -d \
  --name print-farm-controller \
  --restart unless-stopped \
  -p 4242:4242 \
  -e DISCOVERY_SUBNET=192.168.1.0/24 \
  -v pfc-data:/data \
  -v pfc-logs:/logs \
  ghcr.io/andy-knight/print-farm-controller:latest
```

Replace `192.168.1.0/24` with the subnet containing the printers. If LAN scanning is not required, `DISCOVERY_SUBNET` can be omitted and printers can still be added directly by IP.

Versioned images are published from Git tags. For example, tag `v0.33.0` publishes:

```text
ghcr.io/andy-knight/print-farm-controller:0.33.0
ghcr.io/andy-knight/print-farm-controller:0.33
```

The `latest` tag is published from the `main` branch.

### Automated GHCR publishing

`.github/workflows/container-image.yml` runs the Node regression suite, starts a real Linux smoke-test container, then builds `linux/amd64` and `linux/arm64` images with Docker Buildx. Publishing uses the repository-scoped GitHub `GITHUB_TOKEN`; no manually stored registry password or PAT is required.

Pull requests build and validate without publishing. Pushes to `main` publish `latest`, while version tags such as `v0.33.0` publish versioned image tags.

The repository includes a Linux-container `Dockerfile` based on Node.js 24. Controller state and diagnostic logs should be mounted separately so recreating the container does not lose configuration or Print Library data.

Build the image:

```powershell
docker build -t print-farm-controller:0.33.0 .
```

Create persistent host directories:

```powershell
mkdir container-data
mkdir container-logs
```

Run the controller:

```powershell
docker run --rm `
  --name print-farm-controller `
  -p 4242:4242 `
  -v "${PWD}\container-data:/data" `
  -v "${PWD}\container-logs:/logs" `
  print-farm-controller:0.33.0
```

Open `http://localhost:4242`.

The container uses:

- `DATA_DIR=/data`
- `LOG_DIR=/logs`
- `HOST=0.0.0.0`
- `PORT=4242`
- the signed licence at `/data/license.json`

### Docker LAN discovery

Docker Desktop places containers on a virtual network, so the controller cannot reliably infer the Windows host's physical LAN subnet. Directly configured printers continue to work, but **Scan LAN** should be given the physical printer subnet with `DISCOVERY_SUBNET`.

Find the Windows IPv4 address and subnet with:

```powershell
ipconfig
```

For a typical host address such as `192.168.1.25` with subnet mask `255.255.255.0`, use:

```text
DISCOVERY_SUBNET=192.168.1.0/24
```

Start the container with that value:

```powershell
docker run --rm `
  --name print-farm-controller `
  -p 4242:4242 `
  -e DISCOVERY_SUBNET=192.168.1.0/24 `
  -v "${PWD}\container-data:/data" `
  -v "${PWD}\container-logs:/logs" `
  print-farm-controller:0.33.0
```

`DISCOVERY_SUBNET` accepts bounded IPv4 CIDRs from `/22` through `/30`. It is optional; when omitted, native interface-based discovery behaves exactly as before. The setting affects discovery only and does not change normal printer connections.


Open:

```text
http://localhost:4242
```

Other devices on the same LAN can use:

```text
http://<controller-computer-ip>:4242
```

## K3s / Kubernetes deployment

The published GHCR image can run directly in K3s or Kubernetes. The container runs as the non-root Node user (UID/GID 1000), so persistent volumes mounted at `/data` and `/logs` must be writable by that user. A pod-level `fsGroup: 1000` has been validated successfully with K3s PVCs.

Example deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: controller
  namespace: pfc
spec:
  replicas: 1
  selector:
    matchLabels:
      app: controller
  template:
    metadata:
      labels:
        app: controller
    spec:
      securityContext:
        fsGroup: 1000

      containers:
        - name: controller
          image: ghcr.io/andy-knight/print-farm-controller:latest
          imagePullPolicy: Always

          securityContext:
            runAsUser: 1000
            runAsGroup: 1000
            runAsNonRoot: true

          ports:
            - containerPort: 4242

          # Optional. Set this when LAN discovery needs the physical
          # printer subnet rather than the pod/container network.
          env:
            - name: DISCOVERY_SUBNET
              value: 192.168.1.0/24

          volumeMounts:
            - name: data
              mountPath: /data
            - name: logs
              mountPath: /logs

      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: pfc-data
        - name: logs
          persistentVolumeClaim:
            claimName: pfc-logs
```

The image already defines `DATA_DIR=/data`, `LOG_DIR=/logs`, `HOST=0.0.0.0` and `PORT=4242`, so those environment variables do not need to be repeated in the Deployment unless you deliberately want to override them.

If the pod enters `CrashLoopBackOff` and the logs contain errors such as:

```text
EACCES: permission denied, open '/logs/controller.log'
EACCES: permission denied, mkdir '/data/.backup-staging'
```

the PVCs are not writable by the non-root controller process. Keep `fsGroup: 1000` on the pod. If the storage backend does not honour `fsGroup`, use a root init container to set ownership before the controller starts:

```yaml
initContainers:
  - name: fix-permissions
    image: busybox:1.36
    command:
      - sh
      - -c
      - chown -R 1000:1000 /data /logs
    securityContext:
      runAsUser: 0
    volumeMounts:
      - name: data
        mountPath: /data
      - name: logs
        mountPath: /logs
```

Because the GHCR package is public, no `imagePullSecret` is required. Use the fully-qualified image name `ghcr.io/andy-knight/print-farm-controller:latest`; omitting `ghcr.io/` makes Kubernetes try Docker Hub instead.

## Windows Portable Executable

Print Farm Controller includes a Windows x64 Node SEA packaging pipeline for building a standalone portable executable. Development/source mode remains unchanged: `npm start` runs directly from the repository.

Install the build-only dependencies once:

```powershell
npm install
```

Run the full regression suite:

```powershell
npm test
```

Build the portable Windows x64 executable:

```powershell
npm run build:sea:windows
```

The build command bundles the Node server with esbuild, adds the controller UI, simulator UI/resources and trusted Ed25519 public verification keys as Node SEA assets, generates the SEA blob with the local Node 24 runtime, then injects that blob into a copy of `node.exe`.

The clean build output is:

```text
dist/
└── windows-x64/
    └── PrintFarmController.exe
```

Start `PrintFarmController.exe` and open:

```text
http://localhost:4242
```

The executable reads its built-in web/simulator resources and trusted licence public keys directly from the SEA payload. It creates `data/` beside the executable for persistent controller state. All deployments store the replaceable signed customer licence at `data/license.json` by default, keeping executable/application files separate from persistent state. A valid previous application-directory `license.json` is automatically migrated into the data directory.

The Ed25519 private signing key is never included in the controller. The Bambu simulator TLS key embedded in the executable is only a local simulator/test credential and is unrelated to production licence signing.

The copied Node executable's original Authenticode signature is invalidated when the SEA payload is injected, so the build may report a signature warning. The final installer/release process will digitally sign the finished `PrintFarmController.exe` after all embedding is complete.

### Windows installer

The Windows installer uses **Inno Setup 7** (preferred; Inno Setup 6 remains supported as a fallback) and installs the controller under Program Files. The executable remains protected by normal Program Files permissions, while the installer creates only the `data/` directory with standard-user modify permission so printer configuration, queue/library state, simulator settings and `data/license.json` can be updated without running the controller as Administrator.

Install Inno Setup 7 x64, then build an unsigned installer with:

```powershell
npm run build:installer:windows
```

This rebuilds the hardened SEA executable first, then creates:

```text
dist/
└── installer/
    └── PrintFarmController-Setup-v0.16.0.exe
```

The installer creates a Start Menu shortcut and offers an optional desktop shortcut. Uninstalling the application does not explicitly delete the `data/` directory, so user data is not intentionally removed by the uninstall script.

## Printer Emulator

Start the controller normally:

Open the controller and select **Printer simulator**, or go directly to:

```text
http://<Controller-IP>:4242/simulator/
```

The simulator is disabled by default. Enable it from that page to start the loopback endpoints; the setting is remembered, the endpoints start with the controller on later launches, and they stop when the controller stops. It creates simulated FlashForge Adventurer 5M Pro, Snapmaker U1, Bambu Lab P1P, Bambu Lab P1S, Bambu Lab X1C and Bambu Lab A1 Mini printers, and displays the exact host, ports and credentials for each endpoint. Additional instances receive non-conflicting ports automatically.

The simulator uses the same responsive visual system and shared light/dark preference as the main controller. Its UI provides live state, progress and temperature controls; accelerated print time; virtual printer files; activity logs; repeatable scenarios; and fault injection for retained filenames, persistent cancellation, failed verification, rejected or malformed commands, delayed responses and unavailable cameras. Bambu profiles can emulate zero to four four-slot AMS units plus the external spool, with editable material, colour, loaded state and active source. FlashForge uses a continuous MJPEG camera stream, Snapmaker uses its Moonraker WebSocket/snapshot sequence, and the Bambu profiles expose TLS MQTT status/control, implicit FTPS file transfer and the authenticated local camera stream. All state changes are streamed live to the browser.

Default endpoints are:

```text
FlashForge HTTP:  127.0.0.1:18898
FlashForge TCP:   127.0.0.1:18899
FlashForge camera 127.0.0.1:18080
Snapmaker U1:     127.0.0.1:17125
Bambu P1P MQTT:   127.0.0.1:18883
Bambu P1P FTPS:   127.0.0.1:19990
Bambu P1P camera: 127.0.0.1:16000
Bambu P1S MQTT:   127.0.0.1:18893
Bambu P1S FTPS:   127.0.0.1:20000
Bambu P1S camera: 127.0.0.1:16010
Bambu X1C MQTT:   127.0.0.1:18903
Bambu X1C FTPS:   127.0.0.1:20010
Bambu X1C camera test endpoint: 127.0.0.1:16020
Bambu A1 Mini MQTT:   127.0.0.1:18913
Bambu A1 Mini FTPS:   127.0.0.1:20020
Bambu A1 Mini camera: 127.0.0.1:16030
```

For FlashForge, the Add printer form now exposes the normally fixed HTTP, TCP and camera ports. Physical printers retain their standard defaults of 8898, 8899 and 8080. Snapmaker already supports a configurable Moonraker port.

Set `EMULATOR_NO_DEFAULTS=1` to start with an empty simulator fleet, or `CONTROLLER_EMULATOR_ENABLED=1` to enable the integrated simulator for the current launch. The virtual protocol endpoints always use loopback in integrated mode. The standalone `npm run emulator` command remains available for development and retains its `EMULATOR_HOST` and `EMULATOR_PORT` overrides.

The Bambu endpoints use a simulator-owned self-signed certificate, MQTT username `bblp`, and the access code shown in the emulator UI. They model the LAN/Developer interfaces used by P1, X1C and A1 Mini printers but remain experimental until compared with physical hardware. The X1C camera test endpoint produces the simulator's existing TLS/JPEG test frames and does not claim to emulate the physical X1C RTSPS/H.264 stream. The emulator verifies controller behaviour against the implemented protocol model; new manufacturer support remains experimental until checked against reliable captures, documentation or physical hardware.

### Adding an experimental Bambu P1P, P1S, X1C or A1 Mini

1. Enable the printer's LAN Only or Developer mode and note its serial number and LAN access code.
2. Click **+ Add printer** and select **Bambu Lab P1P / P1S / X1C / A1 Mini (experimental)**.
3. Choose `P1P`, `P1S`, `X1 Carbon (X1C)` or `A1 Mini` from the model dropdown, then enter the IP address, serial number and access code.
4. Keep the physical-printer defaults of MQTT TLS `8883` and implicit FTPS `990`. P1P/P1S/A1 Mini camera TLS defaults to `6000`; selecting X1C changes the stored camera port to its RTSPS default `322`, although X1C camera decoding is not yet enabled. Use the alternate ports displayed by the emulator only for simulated printers.
5. **Test & add** validates the MQTT credentials before saving the printer.

Bambu discovery is not yet implemented, so supported Bambu printers are added manually. Access codes remain backend-side and are never returned by the public fleet API. Until physical validation is complete, supervise test prints and do not rely on this adapter for unattended production.

### Experimental Bambu AMS workflow

- The printer detail view shows each reported AMS tray and the external spool, including loaded state, material, colour and active source.
- Before printing or queueing a sliced `.3mf`, the controller reads the embedded plate G-code and lets each logical filament be mapped to a loaded source. Exact material-and-colour matches are selected automatically when possible.
- File-centric automatic queue jobs use the live AMS inventory when choosing a compatible P1P/P1S/X1C/A1 Mini and recheck that mapping immediately before print start.
- Multi-material Bambu jobs require `.3mf`. P1P/P1S/X1C and A1 Mini allow raw `.gcode` for single-material starts; the A1 Mini `gcode_file` path remains experimental until physically validated.
- P1-family and A1 Mini printers still have one nozzle. Multiple filaments are valid, but conflicting nozzle-size requirements are rejected.

AMS behavior is implemented against the emulator protocol model and must remain experimental until start commands and telemetry are confirmed on physical P1P/P1S/X1C/A1 Mini hardware with the applicable AMS/AMS Lite configuration.

## Supported features

### Fleet

- Automatic local discovery for FlashForge 5M-family printers.
- Automatic bounded LAN discovery for Snapmaker U1 / compatible U1 Moonraker instances.
- Add/remove printers and persistently rename the controller display name without changing printer-side identity.
- Persistent drag-and-drop dashboard ordering.
- Accessible light/dark appearance switch with browser persistence and automatic device-theme default.
- Live backend polling with SSE updates.
- Online/offline state, progress, layers, temperatures, ETA, and diagnostics.
- Backend camera proxy with shared MJPEG streams and cached dashboard snapshots.
- Multi-printer selection and batch actions.
- Verified multi-printer G-code distribution.
- Persistent **High / Normal / Low queue priorities** for individual jobs and production batches. Priority ranks before manual order, waiting jobs gain one effective priority level every six hours, and automatic assignment prefers a ready compatible printer where the file is already verified.
- Persistent print queue with two assignment modes: existing **fixed-printer** jobs for files already stored on a printer, plus **Next available compatible printer** jobs backed by a controller-staged file. Automatic jobs are evaluated against the live fleet, uploaded/verified on the selected printer, rechecked immediately before start, and survive controller restarts.
- Queue states: **Queued**, **Needs review**, **Starting**, **Printing**, **Completed**, **Failed**, and **Cancelled**. Queued jobs can be reordered or cancelled, including cancelling the active printer job when appropriate. A **Needs review** job blocks later jobs for the same printer until it is corrected/rechecked or cancelled.
- Persistent print history with printer, file, timestamps, duration/result, and **Reprint**. Completed or active-failed/cancelled queue jobs create a **Waiting for bed clearance** interlock; **Bed cleared** must be confirmed before the next queued print can start. Outstanding clearance records are retained even when normal history is cleared.
- Queue/history updates are included with the live fleet stream, so multiple open browsers see the same controller-side scheduler state.
- **Maintenance tracking** is available from the controller overflow menu. Maintenance tasks can be assigned either to one printer or to a printer model. Model-wide rules are stored once and inherited automatically by every current and future matching printer, while each printer keeps its own assignment date, usage baseline, completion state and history. A shared model rule can also be completed in one action across all currently eligible matching printers; printers that have not yet reached the Due-soon threshold are skipped rather than being reset early. Recurring service can be based on calendar days, controller-observed print hours, or observed print cycles. Tasks show Current / Due soon / Due state, can be enabled/disabled or edited, and retain completion history with optional notes and usage snapshots. The controller stores this separately from printer firmware so the workflow is manufacturer-agnostic. A live top-bar alarm appears for printers that are Due soon or Due and acts as a maintenance-only dashboard filter; printer cards and printer details carry matching wrench status indicators.

### FlashForge Adventurer 5M / 5M Pro

- Nozzle temperature up to 265 °C.
- Bed temperature up to 110 °C on later firmware.
- Cooling/chamber fans and filtration controls.
- Bed levelling.
- Full local storage file list via TCP M661, ordered with recently printed files first.
- File upload and optional verified print start.
- Pause/resume/cancel.
- Camera stream.
- Timed bed-powered chamber preheat with idle-target reassertion.
- **Toolhead status** shows the filament type reported by the printer (for example PLA/PETG) from the local `/detail` API. You can also set a persistent **Controller material designation** (common presets or a custom material name); while assigned, it becomes the effective material shown by the controller and is marked **Manually assigned**, while the original printer-reported value is retained as secondary information. **Use printer value / Clear designation** removes the override. The designation is stored locally with that printer and does not change FlashForge firmware settings. The 5M API does not provide U1-style RFID colour metadata or a reliable live filament-presence value, so those remain explicitly unavailable.
- FlashForge file-material preflight compares that manual designation with the filament type declared by G-code metadata (including Orca/FlashForge `right_extruder_material` and slicer `filament_type` comments) when the controller has inspected the file. Equivalent punctuation variants such as `ASA CF`, `ASA-CF`, and `ASA_CF` compare as the same material. A direct **Print** shows an advisory mismatch and permits **Print anyway** by confirmation; a queued or fleet upload/start mismatch is not started unattended and is held/reported for review. The stock 5M local API exposes filenames but not the stored G-code body, so files copied to the printer outside Print Farm Controller have an explicitly unknown material requirement until the controller has an inspected copy.

### Snapmaker U1

- Desktop printer details now use two stable columns. Toolhead status and Maintenance stay anchored on the right, so expanding XYZ toolhead calibration only pushes the right-side panels below Maintenance downward instead of rebalancing Toolhead status into the left column. Chamber preheat and Fans use the lower-left space beneath the file area. The dialog remains wider on larger displays and collapses back to one column on narrower screens.
- Native Moonraker/Klipper LAN connection (default port 7125).
- Four independent tool temperatures: T0, T1, T2, T3.
- Active tool shown on the fleet dashboard.
- Per-tool filament presence from the U1 motion sensors, with independent T0–T3 material cards.
- Effective U1 per-tool material configuration: manually assigned third-party filament type/subtype/colour is shown from `print_task_config`; Snapmaker RFID metadata remains the automatic source/fallback. Third-party filament still reports physical presence independently.
- Advisory material preflight before starting a stored U1 file or a selected-fleet upload/start. It summarizes which U1 toolheads currently report filament but does not block jobs because a file may use only a subset of the four tools.
- U1 multi-tool print setup for stored G-code: the controller reads Moonraker/slicer tool metadata, shows each logical file tool and requested material/colour/nozzle diameter, and lets you map it to physical T0–T3 before starting. Loaded-colour and nozzle-size matches are selected automatically when possible.
- U1 stored files can also be added to the fleet print queue from the same Print setup UI. Tool mapping, bed levelling, flow calibration, timelapse, replenishment and entanglement preferences are stored with the queued job. Before an unattended queued start, the controller performs a fresh U1 status read and compares the mapped physical heads with their queue-time state; a removed/changed filament assignment or nozzle change fails the queued start instead of silently printing with stale setup. Reprinting a U1 history item reopens current Print setup rather than blindly reusing an old physical-head mapping.
- The U1 physical-head mapping dropdown uses the same circular filament colour swatches as Toolhead status; raw loaded-filament hex colour codes are kept internal for matching and are not shown in the dropdown labels.
- Used-tool readiness warnings are scoped to the heads actually selected for the file. Empty heads, material/colour mismatches, and requested-vs-installed nozzle-size mismatches are clearly warned; ambiguous reuse of one physical head for different/unknown file colours is blocked.
- U1 Print setup includes **Level bed before print**, optional **Flow calibration**, **Timelapse**, **Auto filament replenishment**, and **Filament entanglement detection** with Low/Medium/High sensitivity. These are sent through Snapmaker's native `SET_PRINT_PREFERENCES` immediately before print start; the UI reflects the printer's current preference values when available.
- Nozzle limits up to 300 °C per U1 firmware configuration.
- Heated bed control up to 100 °C per U1 firmware configuration.
- U1 cavity/chamber temperature sensor display.
- Live physical toolhead readiness for T0–T3: installed nozzle diameter, nozzle volume type (for example standard/high-flow when reported), and the U1's current XYZ extruder offset are read directly from each stock extruder status object.
- Guided **XYZ toolhead offset calibration** under Maintenance using Snapmaker's stock calibration state machine and touchscreen-style orchestration: Start cleaning sequence → T0 is prepared automatically → confirm each manual clean to cool that head and automatically prepare T1, T2 and T3 in order → remove and verify build plate removed → the U1 automatically probes T0–T3. Each cleaning stage uses the U1's native heat, automatic nozzle-clean and manual-clean position before waiting for the user's confirmation, then cools to the stock 140 °C calibration temperature. The controller does not expose duplicate per-tool Probe buttons because real U1 hardware automatically advances into the T0–T3 XYZ measurements after the plate-removal verification. The U1 automatically saves when all four probes complete; manual Save and Finish/exit controls are also provided for recovery.
- Print state, progress, layer information (when supplied by the sliced G-code), elapsed time and estimated remaining time.
- Complete Moonraker G-code file list, with Moonraker job history used to put recently printed files first.
- Checksum-verified G-code upload.
- Verified upload before optional print start.
- Pause/resume/cancel.
- Stock built-in chamber camera through Snapmaker's native `camera.start_monitor` WebSocket plugin and `/server/files/camera/monitor.jpg`. The controller synthesizes an MJPEG stream from the U1's ~1 fps snapshots; no printer-side webcam bridge or custom firmware is required.
- Chamber/cavity circulation fan control through the stock `fan_generic cavity_fan` Klipper object.
- Optional top-cover purifier control: independent 0–100% internal/filter and exhaust speeds, with live percentage/RPM state when reported. If the purifier hardware is not detected, the UI disables those controls.
- Controller-triggered heated bed mesh calibration through the stock `AUTO_BED_MESH_CALIBRATE` routine. The controller only starts this while the printer is idle and asks for confirmation because the printer heats and moves during calibration.
- Timed chamber preheat using the bed as the heat source plus Snapmaker's stock `PREHEAT_CHAMBER` purifier mode. The native mode runs the inner purifier circulation fan at 60% and keeps the exhaust off while the controller holds the bed setpoint for the selected duration. The live chamber sensor remains visible during the session.
- Fleet-wide manual temperature setting is intentionally not offered. Use each printer detail view for nozzle/tool and bed targets. **Heaters off** remains a fleet safety action and explicitly turns off all four U1 tool heaters plus the bed. Chamber-fan and chamber-preheat fleet controls are also supported.

The XYZ toolhead-offset workflow is implemented against Snapmaker's stock firmware commands, regression-tested with a simulated endpoint, and has now been completed successfully on physical U1 hardware through the controller workflow.

## Adding a Snapmaker U1

1. Make sure the U1 and controller computer are on the same local network.
2. Click **+ Add printer** and **Scan LAN**. The controller scans the local /24 network for Moonraker and only accepts instances exposing the U1 four-tool/Snapmaker object set.
3. If discovered, click **Use**.
4. If adding manually, choose **Snapmaker U1 (Moonraker)**, enter the printer IP/hostname, and leave the Moonraker port at `7125` unless your setup exposes Moonraker through another port.
5. The API key can normally be left blank on the stock trusted LAN. If your Moonraker authorization configuration requires an API key, enter it in the optional field.
6. Click **Test & add**. The controller queries live Moonraker status before saving the printer.

A useful connectivity check is to browse to the U1's IP address and confirm Fluidd opens. Moonraker itself normally listens on port 7125.

## Snapmaker U1 implementation notes

The U1 adapter queries these Klipper/Moonraker objects:

```text
webhooks
print_stats
virtual_sdcard
display_status
heater_bed
extruder
extruder1
extruder2
extruder3
toolhead
temperature_sensor cavity
fan_generic cavity_fan
purifier
filament_detect
filament_motion_sensor e0_filament
filament_motion_sensor e1_filament
filament_motion_sensor e2_filament
filament_motion_sensor e3_filament
```

Tool-specific temperature commands use Klipper's `SET_HEATER_TEMPERATURE` command against `extruder`, `extruder1`, `extruder2`, and `extruder3`. The fleet-level generic nozzle command uses the currently active extruder.

Material status is read separately from the core status query so a firmware variant missing an optional material/sensor object cannot take the whole printer offline in the controller. `filament_motion_sensor eN_filament` is authoritative for physical filament presence. `print_task_config` supplies the effective per-tool material assignment (`filament_type`, `filament_sub_type`, `filament_color_rgba`, `filament_vendor`, and `filament_official`), including values manually set on the U1 for third-party filament. `filament_detect.info[N]` remains the RFID source/fallback (`VENDOR`, `MAIN_TYPE`, `SUB_TYPE`, and `ARGB_COLOR`). For loaded third-party filament, one toolhead control sets the stock U1 generic material profile and colour together while idle; the controller sends the complete vendor/type/subtype/RGBA tuple required by the firmware and verifies all four values before reporting success.

U1 chamber fan control uses `SET_FAN_SPEED FAN=cavity_fan SPEED=<0..1>`. Purifier control uses the stock `SET_PURIFIER` command against the `inner` and `exhaust` fan channels. Chamber preheat uses `SET_PURIFIER_MODE MODE=2 ...` to engage Snapmaker's native preheat circulation mode while the controller owns the bed setpoint; normal manual/timeout stops return the purifier to idle with immediate fan shutdown. When a print starts, the controller relinquishes preheat ownership without sending bed-off or forcing the purifier idle, allowing the print workflow to take control. Bed levelling uses the stock `AUTO_BED_MESH_CALIBRATE` macro, which heats and soaks the bed before running `BED_MESH_CALIBRATE` according to Snapmaker's printer configuration. When starting a U1 file from the controller, **Level bed before print** is also available; the controller sets Snapmaker's native `SET_PRINT_PREFERENCES BED_LEVEL=1` (or `0` when unchecked) immediately before the Moonraker print-start request, allowing the U1's stock print sequence to own the pre-print mesh step.

For U1 stored-file launches, the controller first builds a bounded print setup from Moonraker metadata plus G-code header/tail metadata when available. Logical tools used by the file are mapped to physical T0–T3 with `SET_PRINT_EXTRUDER_MAP`, and the selected physical heads are declared with `SET_PRINT_USED_EXTRUDERS`. Immediately before print start it sends `SET_PRINT_PREFERENCES BED_LEVEL=<0|1> FLOW_CALIBRATE=<0|1>`, so Snapmaker's stock print sequence owns both optional calibration steps.

Moonraker file management uses:

```text
GET  /server/files/list?root=gcodes
GET  /server/history/list
POST /server/files/upload
POST /printer/print/start
POST /printer/print/pause
POST /printer/print/resume
POST /printer/print/cancel
```

Uploads include a SHA-256 checksum and are verified by re-listing Moonraker storage before the controller optionally starts the print.

The stock U1 camera is not a normal Moonraker webcam. The controller opens a dedicated Moonraker WebSocket and sends `camera.start_monitor` with `domain: "lan"`, then reads the camera frame from `GET /server/files/camera/monitor.jpg`. It repeats the wake command periodically while the camera is in use and converts the resulting ~1 fps JPEG sequence into the same MJPEG proxy interface used by the rest of the fleet.

## Print Library and queue API

The browser uses the controller-side Print Library and scheduler APIs:

```text
GET    /api/library
POST   /api/library
DELETE /api/library/:fileId

GET    /api/queue
POST   /api/queue
PUT    /api/queue/order
POST   /api/queue/:jobId/priority
POST   /api/queue/production/:batchId/priority
DELETE /api/queue/:jobId
POST   /api/queue/:jobId/reprint
POST   /api/queue/:jobId/recheck
DELETE /api/queue/history
POST   /api/queue/bed-clearance/:printerId
```

The Print Library is the durable controller-side source of printable files. Each entry stores the original filename, byte size, SHA-256 and bounded print requirements. Queue/history cleanup never deletes library files; removal is explicit and is blocked while a queue/history record still references the file. Duplicate uploads are detected by SHA-256 and size.

The queue supports both fixed-printer and automatic assignment. Automatic jobs reference a Print Library file, evaluate every configured printer as **Eligible**, **Waiting**, **Needs review**, or **Not compatible**, and reserve one eligible printer at a time. Compatibility includes verified upload/print capability, supported file type, required tool count, loaded material/colour where known, required nozzle diameter, U1 logical→physical tool mapping, online/idle state, existing queue reservations, and the persistent bed-clearance interlock. The library file is uploaded only when required, verified on printer storage, and followed by a fresh live preflight before print start. Fixed-printer jobs keep the original behaviour and remain backward compatible.

After any queued job reaches the printer and then completes, fails, or is cancelled, the controller blocks queue progression for that printer until the build plate is explicitly confirmed clear. Cancelling a job that never started does not create a clearance interlock.

## Application data

By default, persistent controller data is stored in the `data/` sub-directory of the application folder. This keeps the controller configuration and runtime state with the application rather than under the operating-system user profile.

```text
Print-Farm-Controller/
├── data/
│   ├── printers.json
│   ├── print-jobs.json
│   ├── file-material-metadata.json
│   ├── emulator-settings.json
│   └── print-library/
├── public/
├── src/
└── package.json
```

On first startup with this layout, if `data/` does not yet exist, the controller looks for the previous profile-based **Printer Fleet Controller** data directory and migrates the complete directory into `data/`. If that directory is absent, the still older **FlashForge Fleet** location is also recognised. This preserves printer configuration, queue/history, Print Library files, emulator settings and material metadata. Historical `queue-files/` entries are still promoted into `print-library/` by the existing Print Library migration.

The persistent fleet print queue/history is stored as `data/print-jobs.json`. Print Library files live under `data/print-library/`, one UUID directory per file, with metadata, SHA-256, parsed print requirements and cached previews where available. Printer configuration is stored in `data/printers.json`, controller-inspected file material metadata in `data/file-material-metadata.json`, and integrated emulator enablement in `data/emulator-settings.json`. Library lifetime is independent of queue/history lifetime: clearing history never deletes a library file. Library deletion is explicit and is blocked while a current queue/history record still references that file. Queued jobs survive a normal controller restart; interrupted automatic upload/preflight work returns safely to the queue, while jobs already handed to a printer are reconciled against live printer state. Build-plate clearance is persisted on the completed queue record, so restarting the controller or clearing ordinary history cannot accidentally release a printer that is still waiting for its bed to be cleared.

You can still override the storage location with `DATA_DIR`. A custom `DATA_DIR` is used exactly as configured and is not automatically migrated.

Printer secrets such as FlashForge check codes, Bambu LAN access codes and an optional Moonraker API key are stored backend-side and are not returned in public printer/fleet API responses.

## Architecture

```text
Browser UI
   │
   ▼
Local Fleet Controller
   │
   ├── Printer registry
   ├── Fleet state / SSE
   ├── Camera manager
   ├── Batch control
   ├── Chamber preheat
   ├── File distribution
   ├── Print Library
   └── Print queue / history
          │
          ▼
     PrinterAdapter
          │
          ├── flashforge-ad5m
          ├── snapmaker-u1
          │      └── Moonraker / Klipper
          └── bambu-lab (experimental)
                 ├── MQTT TLS status/control
                 ├── implicit FTPS files
                 └── authenticated TLS camera
```

The adapter boundary owns discovery, connection validation, capabilities, thermal limits, status normalization, file operations, job control, temperature control, and camera source selection. Core fleet services do not need manufacturer-specific protocol logic.

## Licence architecture

Print Farm Controller contains only the customer/distribution side of the licensing system:

- signed licence verification
- trusted public verification keys
- licence installation and status UI
- edition and entitlement enforcement

Licence generation, Ed25519 private-key handling and customer licence signing are intentionally maintained in the separate private repository:

```text
Andy-Knight/Print-Farm-Licensing
```

Private signing keys must never be added to this repository. The controller only requires the corresponding public keys in `src/licensing/trusted-public-keys.json`.

### Production licence hardening

Production/default controller startup does not allow environment variables to bypass signed licensing.

In particular:

- `PRINT_CONTROLLER_EDITION` is ignored during normal licence loading.
- `PRINT_CONTROLLER_LICENSE_PUBLIC_KEY_FILE` and `PRINT_CONTROLLER_LICENSE_KEY_ID` are ignored during normal licence loading.
- `LicenseManager` defaults fail closed to Community rather than reading an edition from the environment.
- Installing a valid signed licence reloads and activates it immediately; there is no runtime edition override to take precedence.

The loader still has an internal `allowDevelopmentOverrides:true` option for automated tests or deliberately modified development builds. The production server never enables it. Enabling development overrides therefore requires a source/build change rather than an end-user environment variable.

