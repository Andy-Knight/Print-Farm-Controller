# Print Farm Controller v0.17.0

> **Current release: v0.17.0 Bambu Lab A1 Mini support.** The existing experimental Bambu LAN adapter now supports A1 Mini configuration, status/control, FTPS file handling, TLS/JPEG camera access and AMS Lite material mapping. Single-material `.gcode` starts are enabled on A1 Mini using the existing Bambu `gcode_file` path, but remain experimental until validated on physical hardware; multi-material AMS Lite jobs require sliced `.3mf`. A1 Mini support remains experimental until validated on physical hardware.

> **v0.17.0 adds experimental Bambu Lab A1 Mini support.** A1 Mini uses the existing Bambu MQTT TLS/FTPS integration, the same TLS/JPEG camera path used by P1-family printers, a model-specific 80 °C maximum bed limit, and single-nozzle AMS Lite mapping through the existing Bambu material-source workflow. The controller supports `.3mf` plus single-material `.gcode` on A1 Mini; raw G-code start remains explicitly unverified on physical A1 Mini hardware. The integrated Printer Simulator includes an A1 Mini profile for controller testing.

> **Packaging validation:** the hardened Windows x64 single-executable build has been manually validated successfully with embedded controller UI, simulator resources and trusted licence public keys.

> **Installer validation:** the Inno Setup 7 Windows installer has been built and manually validated successfully under Program Files, including normal non-admin runtime writes to `data/` and packaged licence storage at `data/license.json`.

> **v0.16.1 aligns dashboard available-state colours and Print Library preview presentation.** Idle and Ready printer badges on the main dashboard are green in both Dark and Light modes, while existing warning/error colours remain unchanged. Print Library thumbnail and enlarged preview backgrounds now use the existing Light-mode preview colour (`#f3f7fa`) in both themes so model images are presented consistently.

> **v0.16.0 adds production packaging.** The controller can now be bundled into a hardened Windows x64 Node SEA executable with embedded UI, simulator resources and trusted licence verification keys. The release includes an Inno Setup 7 installer for Program Files deployment, writable application-local `data/`, packaged licence storage at `data/license.json`, and an optional Authenticode signing workflow for future production releases.

> **v0.15.6 adds dashboard fleet filtering and consolidates the latest controller usability/storage improvements.** The Printers, Online, Printing and Needs attention summary cards can filter the dashboard fleet in place; the active filter is highlighted, filtering stays in sync with live printer/queue state, and an empty-filter state provides a quick return to all printers. This build also includes application-local `data/` storage, consistent **Snapmaker U1** model naming, and the combined printer-card hover/focus highlight treatment.

> **v0.15.5 adds visual previews to the Print Library.** The controller extracts and caches slicer-provided preview images when available, using Orca/Bambu-style 3MF plate thumbnails (including `Metadata/plate_1.png` and related fallbacks) and embedded PNG/JPEG G-code thumbnail blocks. Library cards show a compact preview beside the file details; clicking it opens a larger viewer. Existing library files are backfilled automatically the first time they are read, and files without a supported embedded image show a **No preview** placeholder. Preview images are cached as separate files beside the stored print file rather than embedded into `metadata.json`.

> **v0.15.4 adds free-text metadata to Print Library files.** When adding a file, users can optionally enter up to 4000 characters of description/notes explaining what the part is, its intended use, print guidance or other context. Notes are displayed on library cards, included in library search, can be edited later with **Edit details**, and are also available when uploading a new file through the queue workflow.

> **v0.15.3 preserves the red Offline/Error printer status treatment in Light mode.** The generic light-theme badge styling no longer overrides these warning states.

> **v0.15.2 simplifies the controller top bar with a responsive overflow menu.** The Light/Dark toggle remains permanently visible. Printer simulator and Licence move into a compact **⋮** menu, while Fleet operations stays visible on wider screens and automatically moves into the same overflow menu when horizontal space is tighter.

> **v0.15.1 adds detected filament colours to Print Library entries.** When colour metadata is available in the G-code/GX/3MF requirements, each library card now lists the actual colours with a swatch, hexadecimal value and RGB value.

> **v0.15.0 introduces the persistent Print Library.** Controller-owned G-code/GX/3MF files are now durable independently of the queue and history. The dashboard exposes a searchable **Print library** browser where files can be uploaded, inspected for detected material/nozzle/tool requirements, queued to the next compatible printer, or explicitly deleted when no queue/history record still references them. Existing `queue-files/` entries migrate automatically into `print-library/` while retaining their UUIDs, so current queue/history records remain valid. Uploading the same file content again reuses the existing library entry by SHA-256 instead of storing a duplicate.

> **v0.14.12 standardises the Snapmaker model name in the controller UI.** Snapmaker U1 printers display as **Snapmaker U1** on dashboard cards and in printer-details diagnostics, while the stored model remains `U1` and the adapter identity remains unchanged.

> **v0.14.11 aligns the simulated FlashForge material telemetry with physical AD5M-family behaviour.** The simulator still tracks its virtual filament internally, but its FlashForge `/detail` response no longer claims that the printer reports a loaded material type by default. This makes the controller show **Clear designation** instead of **Use printer value** unless a real printer-reported value is actually available.

> **v0.14.10 adds hover/focus colour feedback to all enabled buttons.** Dark mode brightens buttons under the pointer or keyboard focus, while light mode slightly darkens them. Disabled buttons are unchanged.

> **v0.14.9 renames the application from Printer Fleet Controller to Print Farm Controller.** The browser title, dashboard header/footer, controller messages, simulator wording and documentation now use **Print Farm Controller**. Existing application-data directories and machine-facing compatibility identifiers retain their historical `Printer Fleet Controller` / `printer-fleet-controller` names so upgrades, scripts and integrations continue to work without migration.

> **v0.14.8 adds production-hardened offline signed licensing.** The controller verifies Ed25519-signed `license.json` files and fails closed to Community Edition when no valid licence is installed. Community permits 2 physical printers, Pro 10 and Farm 25; simulator printers do not consume licence slots. Existing printers are never deleted if a licence allowance is reduced. Licence installation/replacement is available from the controller UI and takes effect without restarting. Production startup ignores environment-variable attempts to elevate the edition or trust an arbitrary signing key.

> v0.14.x also establishes the controller's edition/entitlement model for future feature gating. The signed licence carries its edition, physical-printer allowance and optional additional feature entitlements. The current production enforcement path includes signed-licence verification and physical-printer slot limits; further feature-by-feature gating can be layered onto the defined entitlement model without changing the licence-file format.

> v0.13.0 now includes an **experimental Bambu Lab P1P/P1S/X1C controller adapter**. It reads LAN status and external-spool/AMS telemetry, maps sliced 3MF filaments to loaded AMS slots, and sends print/job/temperature/fan commands over MQTT TLS. It also performs verified `.3mf`/`.gcode` storage operations over implicit FTPS. P1 cameras feed the existing dashboard camera manager; physical X1C camera decoding is not yet supported because X1C supplies RTSPS/H.264 rather than the P1 TLS/JPEG stream. The implemented workflows are tested against the Bambu emulator but have not been validated on physical Bambu hardware.

> v0.13.0 includes a controller-managed, loopback-only **Printer Simulator** with its own responsive light/dark UI. It can run multiple simulated FlashForge Adventurer 5M Pro, Snapmaker U1, Bambu Lab P1P, P1S and X1C endpoints, exercise the controller's production adapters, accelerate print progress, manage virtual files and temperatures, and inject repeatable connection, cancellation, verification, camera, material and nozzle faults. Simulator support is a development aid and does not replace final validation on physical hardware.

> v0.12.16 adds a combined **Snapmaker U1 third-party filament type and colour control** to each toolhead card. One **Set filament on U1** button sends the selected generic material profile and colour together using stock `SET_PRINT_FILAMENT_CONFIG`; the controller verifies both values and immediately uses them for queue compatibility. The control is available only for idle, loaded, editable third-party slots, while official RFID filament remains locked. The combined workflow has been validated on physical U1 hardware.

> v0.12.15 moves production-batch controls into a dedicated full-width row below the batch copy list, preventing Pause/Resume, priority, quantity and cancellation controls from overlapping batch items at narrower queue widths.

> v0.12.14 adds persistent **High / Normal / Low queue priorities** for individual jobs and production batches. The scheduler ranks priority before manual order, promotes waiting work one level every six hours to prevent starvation, prefers a compatible printer where the file is already verified, and records why a printer was selected.

> v0.12.13 adds an accessible **Light / Dark** appearance switch in the main header. The selected theme is saved in the browser; before a choice is made, the interface follows the device colour-scheme preference.

> v0.12.12 prevents a newly assigned queue job from inheriting the previous print's retained 100% progress. A job remains **Starting — 0%** until an active printer state confirms the new print, including when the same filename is reprinted; progress is then tracked only from the confirmed new run.

> v0.12.11 presents FlashForge's latched `CANCEL` result as **Cancelled** while bed clearance is pending and **Ready** after acknowledgement. The raw printer status remains visible in the printer detail diagnostics and is not altered or reset on the printer.

> v0.12.10 fixes FlashForge queue recovery when the printer retains `CANCEL` and the cancelled filename. Cancelled states now create or retain a bed-clearance interlock, then become startable only after the operator confirms the bed is clear. This also covers prints cancelled outside the controller.

> v0.12.9 fixes Snapmaker U1 queue availability after a completed print. Moonraker may retain the previous filename after reporting an idle/complete state; the queue now treats the explicit idle state as authoritative while continuing to enforce the separate bed-clearance interlock.

> v0.12.8 adds **native Snapmaker U1 filament colour editing** for manually assigned third-party filament. Toolhead status can write a selected colour to the idle U1 using its stock `SET_PRINT_FILAMENT_CONFIG` command, verifies the printer read-back, and keeps official RFID filament colours locked.

> v0.12.7 shows FlashForge controller-assigned filament colours as both hexadecimal and **RGB(r, g, b)** values in Toolhead status. The stored colour and automatic queue compatibility behaviour are unchanged.

> v0.12.6 keeps the Snapmaker U1 hexadecimal filament colour on the main toolhead metadata line and moves **RGB(r, g, b)** onto its own line so the value fits cleanly inside each toolhead status card. Print setup and material preflight keep the combined hex + RGB display.

> v0.12.5 shows Snapmaker U1 filament colours as both hexadecimal and **RGB(r, g, b)** values in toolhead metadata, material preflight, and physical-head choices.

> v0.12.4 adds a persistent **filament colour designation** alongside material type for FlashForge printers. The printer window now provides a colour picker; the controller-normalized tool state and automatic queue compatibility use the assigned colour, including blocking explicit colour mismatches.

> v0.12.3 adds **Upload file** inside each supported printer window. Individual uploads use the printer adapter's declared file types, are verified in printer storage before reporting success, save available material metadata, and refresh the printer file list after upload.

> v0.12.2 adds **Reprint batch** to finished production batches in Recent history. Reprinting creates a new automatic production batch with the same quantity, staged controller file and print options while preserving the original history.

> v0.12.1 adds dedicated regression coverage ensuring a cancelled queued print remains in Recent history and can be reprinted with its original staged file and print options.

> v0.12.0 adds **production quantity / batch printing**. A single staged G-code can represent 2–999 copies, with copies automatically distributed across compatible idle printers. Production batches expose overall progress, per-copy printer/status, pause/resume, cancel remaining copies, and safe quantity changes while retaining existing bed-clearance and preflight protections.

> v0.11.3 makes **Clear history** immediately delete controller-staged queue files that are no longer referenced. Files still referenced by queued/active/review jobs, retained bed-clearance records, or another history item are preserved. The normal one-hour orphan grace period remains in place for non-explicit cleanup paths. **This is historical behavior and is superseded by v0.15.0:** migrated Print Library files are no longer pruned by queue/history cleanup and require explicit deletion.

> v0.11.2 moved the default controller application-data directory to the then-current manufacturer-neutral **Printer Fleet Controller** path. Current builds now store runtime data in the application-local `data/` directory instead of the user profile. On first startup, existing data is migrated automatically from the former profile location (or the older `FlashForge Fleet` location), including printer configuration, queue/history, Print Library files, emulator settings and material metadata. Custom `DATA_DIR` locations are unchanged.

> v0.11.1 adds a persistent **Controller nozzle designation** for FlashForge 5M-family printers. Set the installed nozzle diameter in Toolhead status so file-centric automatic queue compatibility can safely match staged G-code nozzle requirements instead of holding FlashForge jobs for review when the local API cannot report nozzle size.

> v0.11.0 adds a file-centric **Next available compatible printer** queue. The controller can persistently stage an uploaded G-code file, inspect its tool/material/colour/nozzle requirements, evaluate the live fleet, choose an eligible idle printer with a clear bed, upload and verify the file, run a fresh printer-specific preflight, and then start it. Existing fixed-printer queue jobs remain supported.

A local-first 3D printer fleet controller. It runs entirely on your LAN and currently supports:

- **FlashForge Adventurer 5M / 5M Pro** through the local FlashForge HTTP/TCP APIs.
- **Snapmaker U1** through its local Moonraker/Klipper API.
- **Bambu Lab P1P / P1S / X1C / A1 Mini (experimental)** through the local MQTT TLS and FTPS TLS interfaces. P1P/P1S/A1 Mini use the TLS/JPEG camera path; X1C camera decoding remains unsupported.

The application is named **Print Farm Controller**. The default application-data directory retains its historical **Printer Fleet Controller** / `printer-fleet-controller` folder name for compatibility; existing installations therefore continue to use the same configured printers, queued work and settings after the v0.14.9 branding rename.

## Licensing

Print Farm Controller uses offline Ed25519-signed licence files. The controller contains trusted **public** verification keys only; private signing keys are never required by the controller.

If no valid signed licence is installed, the controller runs as **Community Edition**.

| Edition | Physical printers | Notes |
| --- | ---: | --- |
| Community | 2 | Default when no valid licence is installed |
| Pro | 10 | Signed Pro licence |
| Farm | 25 | Signed Farm licence |
| Development | Unlimited | Internal development mode only; not enabled by normal production startup |

Simulator printers do **not** consume physical-printer licence slots.

If an installed licence allows fewer physical printers than are already configured, the controller does not delete or forget any printer. All configured printers remain visible and saved; the permitted number can be selected as active licence slots.

### Licence file

The normal licence location depends on how the controller is run:

```text
Source/development: <controller application directory>/license.json
Packaged SEA:       <controller application directory>/data/license.json
```

Packaged builds prefer `data/license.json` so an installation under Program Files can remain read-only for normal users. A previous application-directory `license.json` is still accepted for migration; reinstalling the licence moves it to the current packaged data location.

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

```bash
npm start
```

Open:

```text
http://localhost:4242
```

Other devices on the same LAN can use:

```text
http://<controller-computer-ip>:4242
```

## Production packaging (development)

The current `feature/production-packaging` branch contains the hardened Windows x64 Node SEA packaging pipeline. Development/source mode remains unchanged: `npm start` still runs directly from the repository.

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

The executable reads its built-in web/simulator resources and trusted licence public keys directly from the SEA payload. It creates `data/` beside the executable for persistent controller state. Packaged builds also store the replaceable signed customer licence at `data/license.json`, keeping the executable/application directory read-only for normal users. A previous application-directory `license.json` remains readable for migration.

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

### Windows code signing

Authenticode signing is performed **after** the SEA payload has been injected. For a signed release the workflow is:

```text
Build SEA executable
→ sign PrintFarmController.exe
→ build installer containing the signed EXE
→ sign installer
```

The signing script supports either a certificate already installed in the Windows certificate store or a PFX file. Configure `signtool.exe` using `SIGNTOOL_PATH` if it is not already on PATH, and configure one signing identity:

```powershell
$env:PFC_SIGN_CERT_SHA1="<certificate thumbprint>"
# or:
$env:PFC_SIGN_PFX="C:\path\to\code-signing.pfx"
$env:PFC_SIGN_PFX_PASSWORD="<password>"
```

Also set the RFC 3161 timestamp URL recommended by the code-signing certificate provider:

```powershell
$env:PFC_TIMESTAMP_URL="<timestamp URL>"
```

Then create the complete signed release with:

```powershell
npm run release:windows
```

The release script signs and verifies both the finished controller executable and the final installer.

## Printer Emulator

Start the controller normally:

```bash
npm start
```

Open the controller and select **Printer simulator**, or go directly to:

```text
http://localhost:4242/simulator/
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

