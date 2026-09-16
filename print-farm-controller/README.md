# Printer Fleet Controller v0.12.15

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

> v0.11.3 makes **Clear history** immediately delete controller-staged queue files that are no longer referenced. Files still referenced by queued/active/review jobs, retained bed-clearance records, or another history item are preserved. The normal one-hour orphan grace period remains in place for non-explicit cleanup paths.

> v0.11.2 moves the default controller application-data directory to a manufacturer-neutral **Printer Fleet Controller** path. Existing data is migrated automatically from the historical `FlashForge Fleet` directory on first startup, including printer configuration, queue/history, staged queue files, and material metadata. Custom `DATA_DIR` locations are unchanged.

> v0.11.1 adds a persistent **Controller nozzle designation** for FlashForge 5M-family printers. Set the installed nozzle diameter in Toolhead status so file-centric automatic queue compatibility can safely match staged G-code nozzle requirements instead of holding FlashForge jobs for review when the local API cannot report nozzle size.

> v0.11.0 adds a file-centric **Next available compatible printer** queue. The controller can persistently stage an uploaded G-code file, inspect its tool/material/colour/nozzle requirements, evaluate the live fleet, choose an eligible idle printer with a clear bed, upload and verify the file, run a fresh printer-specific preflight, and then start it. Existing fixed-printer queue jobs remain supported.

A local-first 3D printer fleet controller. It runs entirely on your LAN and currently supports:

- **FlashForge Adventurer 5M / 5M Pro** through the local FlashForge HTTP/TCP APIs.
- **Snapmaker U1** through its local Moonraker/Klipper API.

The application is named **Printer Fleet Controller**. From v0.11.2 the default application-data directory is manufacturer-neutral; existing installations are migrated automatically from the historical FlashForge-named directory so configured printers and queued work are retained.

## Run

Requires Node.js 20 or later. There are no npm runtime dependencies.

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
- FlashForge file-material preflight compares that manual designation with the filament type declared by G-code metadata (including Orca/FlashForge `right_extruder_material` and slicer `filament_type` comments) when the controller has inspected the file. Equivalent punctuation variants such as `ASA CF`, `ASA-CF`, and `ASA_CF` compare as the same material. A direct **Print** shows an advisory mismatch and permits **Print anyway** by confirmation; a queued or fleet upload/start mismatch is not started unattended and is held/reported for review. The stock 5M local API exposes filenames but not the stored G-code body, so files copied to the printer outside Printer Fleet Controller have an explicitly unknown material requirement until the controller has an inspected copy.

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

Material status is read separately from the core status query so a firmware variant missing an optional material/sensor object cannot take the whole printer offline in the controller. `filament_motion_sensor eN_filament` is authoritative for physical filament presence. `print_task_config` supplies the effective per-tool material assignment (`filament_type`, `filament_sub_type`, `filament_color_rgba`, `filament_vendor`, and `filament_official`), including values manually set on the U1 for third-party filament. `filament_detect.info[N]` remains the RFID source/fallback (`VENDOR`, `MAIN_TYPE`, `SUB_TYPE`, and `ARGB_COLOR`).

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

## Print queue API

The browser uses the controller-side scheduler API:

```text
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

The queue supports both fixed-printer and automatic assignment. Automatic jobs persist a controller-side staged file (including SHA-256 and bounded G-code requirements metadata), evaluate every configured printer as **Eligible**, **Waiting**, **Needs review**, or **Not compatible**, and reserve one eligible printer at a time. Compatibility includes verified upload/print capability, supported file type, required tool count, loaded material/colour where known, required nozzle diameter, U1 logical→physical tool mapping, online/idle state, existing queue reservations, and the persistent bed-clearance interlock. The staged file is uploaded only when required, verified on printer storage, and followed by a fresh live preflight before print start. Fixed-printer jobs keep the original behaviour and remain backward compatible.

After any queued job reaches the printer and then completes, fails, or is cancelled, the controller blocks queue progression for that printer until the build plate is explicitly confirmed clear. Cancelling a job that never started does not create a clearance interlock.

## Application data

The default application-data directory is now manufacturer-neutral. On first v0.11.2 startup, if the new directory does not yet exist but the historical `FlashForge Fleet` directory does, the controller migrates the complete directory before fleet and queue startup. That preserves `printers.json`, `print-jobs.json`, `file-material-metadata.json`, staged `queue-files/`, and other controller state. A custom `DATA_DIR` is used exactly as configured and is not migrated.

Windows:

```text
%LOCALAPPDATA%\Print Controller\Printer Fleet Controller\printers.json
```

macOS:

```text
~/Library/Application Support/Print Controller/Printer Fleet Controller/printers.json
```

Linux:

```text
~/.local/share/print-controller/printer-fleet-controller/printers.json
```

The persistent fleet print queue/history is stored beside the printer registry as `print-jobs.json`. Controller-staged automatic-queue files are stored under the sibling `queue-files/` directory with metadata, SHA-256 and parsed print requirements. These are intentionally separate from `printers.json`, so clearing print history cannot remove configured printers. Queued jobs survive a normal controller restart; interrupted automatic upload/preflight work returns safely to the queue, while jobs already handed to a printer are reconciled against live printer state. Build-plate clearance is persisted on the completed queue record, so restarting the controller or clearing ordinary history cannot accidentally release a printer that is still waiting for its bed to be cleared.

You can override the directory with `DATA_DIR`.

Printer secrets such as FlashForge check codes and an optional Moonraker API key are stored backend-side and are not returned in public printer/fleet API responses.

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
   └── Print queue / history
          │
          ▼
     PrinterAdapter
          │
          ├── flashforge-ad5m
          └── snapmaker-u1
                 └── Moonraker / Klipper
```

The adapter boundary owns discovery, connection validation, capabilities, thermal limits, status normalization, file operations, job control, temperature control, and camera source selection. Core fleet services do not need manufacturer-specific protocol logic.
