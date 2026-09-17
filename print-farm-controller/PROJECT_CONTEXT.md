# Printer Fleet Controller — Project Context

> Cross-chat handoff file. Read this first when continuing the project in a new chat. Keep it concise and update it whenever architecture/decisions change, a task is completed, or the current/next task changes.

## Source of truth

- Repository: `Andy-Knight/Print-Farm-Controller`
- Project path: `print-farm-controller/`
- Branch: `feature/bambu-x1c-v0130` (branched from `feature/bambu-ams-v0130`; not merged to `main`)
- Current application version on this branch: **0.13.0**
- Runtime: **Node.js 20+**, ES modules, no npm runtime dependencies.
- GitHub is the authoritative code baseline.

## Architecture

```text
Browser UI (`public/`)
        |
        v
Local Fleet Controller (`src/`)
        |
        +-- printer registry / persistent state
        +-- fleet state + SSE updates
        +-- camera manager
        +-- batch control
        +-- chamber preheat
        +-- file distribution / material metadata
        +-- staged queue-file store
        +-- compatibility engine
        +-- persistent print queue + history + bed-clearance interlock
        |
        v
PrinterAdapter boundary (`src/adapters/`)
        +-- FlashForge Adventurer 5M / 5M Pro
        +-- Snapmaker U1 -> Moonraker / Klipper
        +-- Bambu Lab P1P / P1S / X1C -> experimental MQTT/FTPS adapter + P1 camera

Development Printer Emulator (`emulator/`, loopback only)
        +-- management UI/API + SSE
        +-- shared virtual-printer state and scenarios
        +-- FlashForge HTTP/TCP/camera endpoints
        +-- Snapmaker U1 Moonraker endpoints
        +-- Bambu P1P/P1S/X1C MQTT TLS, FTPS TLS and camera test endpoints
```

Manufacturer-specific discovery, capabilities, limits, status normalization, files, print control, temperatures and camera selection belong behind the adapter boundary. Core fleet services should remain manufacturer-agnostic.

## Important decisions

- Local-first/LAN-only controller; printer credentials remain backend-side.
- Multiple manufacturers are supported through adapters rather than manufacturer logic in shared fleet code.
- Default application data uses the manufacturer-neutral `Printer Fleet Controller` directory. v0.11.2 automatically migrates the complete historical `FlashForge Fleet` directory on first startup; custom `DATA_DIR` locations are never moved.
- Queue/history and controller-staged queue files persist across restarts.
- A completed/active-failed/cancelled print creates a **bed-clearance interlock**; no later queued job may start on that printer until **Bed cleared** is confirmed.
- Queue jobs support two assignment modes: **fixed printer** and **Next available compatible printer**.
- Automatic scheduling is file-centric: the controller owns a durable staged copy, evaluates compatibility/readiness, reserves one printer, uploads/verifies if required, performs a fresh live preflight, then starts.
- Compatibility and readiness are distinct. A printer may be compatible but temporarily blocked by offline/busy/bed-clearance/reservation state.
- Automatic compatibility returns explicit per-printer reasons and distinguishes **Eligible**, **Waiting**, **Needs review**, and **Not compatible**.
- Required nozzle size must not be guessed. If a printer cannot report an explicitly required nozzle, unattended scheduling requires review rather than assuming a match.
- U1 logical-to-physical tool mapping is derived from live material/colour/nozzle state and uses constrained matching to avoid greedy mapping errors.
- Production batches share one staged G-code across multiple run records. Pausing prevents not-yet-started copies from progressing, while active prints continue; cancelling remaining copies also catches copies still in upload/preflight without cancelling prints that have already started.
- Existing fixed-printer queue behaviour remains backward compatible.
- Every delivered version increments the application version and updates README/context.
- The browser appearance switch is accessible, persists only in browser `localStorage`, and follows the device colour scheme until the user explicitly selects Light or Dark.
- Queue priority is **High / Normal / Low**. Effective priority ranks before manual queue order; a waiting job gains one priority level every six hours so low-priority work cannot be starved. Within the same effective priority, manual order remains authoritative.
- When multiple compatible idle printers are ready for an automatic job, a printer with a verified existing copy of the file is preferred; the assigned job records the selection reason.
- The development printer emulator is a separate loopback-only service with its own UI. It exercises production adapters through network protocols rather than bypassing the adapter boundary. Emulator-only support never counts as physical hardware validation.
- Bambu P1P/P1S/X1C support remains explicitly experimental until the MQTT telemetry/commands and FTPS behavior are compared with physical printers. P1 TLS/JPEG camera framing also requires physical validation. X1C uses RTSPS/H.264 on port 322; the controller deliberately reports X1C camera as unsupported until a suitable decoder is implemented. Manual entry is used; Bambu LAN discovery is not yet implemented.
- Bambu AMS support models each AMS tray and the external spool as a material source, separate from the P1's single physical nozzle. Automatic scheduling maps logical 3MF filaments to unique live sources, while multi-material raw G-code is rejected because it does not carry the project-level AMS mapping required by the print command.

## Completed work / current baseline

- FlashForge Adventurer 5M / 5M Pro support.
- Snapmaker U1 support via Moonraker/Klipper, including stock camera integration.
- Experimental Bambu Lab P1P/P1S/X1C controller support: MQTT TLS status, external-spool/AMS material metadata and job/temperature/fan control; implicit FTPS list/upload/verification/download; embedded 3MF plate-G-code requirement parsing; interactive and automatic logical-filament-to-AMS mapping; `.3mf` and single-material `.gcode` print start; authenticated P1 TLS/JPEG camera snapshots; model-specific capabilities/limits and manual connection fields. X1C reports LiDAR availability, a hardened nozzle profile and a 120 °C bed limit, while its RTSPS/H.264 camera remains explicitly unsupported. FTPS upload verification checks the exact filename with `SIZE`, falls back to normalized directory entries and retries briefly for delayed storage visibility.
- Automatic/local discovery, persistent printer registry and controller-side printer renaming.
- Dashboard ordering, SSE fleet state, diagnostics and batch actions.
- Verified file distribution and printer-local file operations.
- Persistent queue/history/reprint/review states and bed-clearance safety interlock.
- Material metadata/preflight for FlashForge and multi-tool print setup/preflight for U1.
- U1 tool mapping, print preferences, material/nozzle readiness and XYZ offset calibration.
- Bed-powered timed chamber preheat and applicable fan/purifier controls.
- **v0.13.0 printer emulator:** standalone loopback service and responsive light/dark management UI; multiple dynamically allocated virtual printers; production-adapter-compatible FlashForge HTTP/TCP/MJPEG camera and Snapmaker Moonraker/WebSocket/snapshot endpoints; experimental Bambu Lab P1P/P1S/X1C TLS MQTT status/control, implicit FTPS file transfer and authenticated camera test endpoints; a visible simulated-camera test frame; virtual files, print progress, temperatures and material/nozzle state; accelerated time; activity logs; repeatable scenarios; and fault injection for offline/delay/rejection/malformed response/verification/cancellation/filename/camera conditions. The X1C test camera intentionally does not emulate physical RTSPS/H.264. Bambu protocol behaviour is emulator-only and awaits physical hardware validation. FlashForge connection forms now expose configurable HTTP, TCP and camera ports while retaining physical-printer defaults.
- v0.13.0 regression suite: **164 passing tests, 0 failures**, including management API, authenticated Bambu P1P/P1S/X1C LAN endpoints, full production Bambu P1S and X1C adapter integration against the live emulator, controlled Bambu model selection, editable zero-to-four-unit AMS simulation, live-refresh-safe AMS material/colour controls, embedded 3MF requirement parsing, interactive and automatic AMS material mapping, queue-to-print mapping propagation, credential-safe Bambu persistence, production Snapmaker and FlashForge adapter integration, and the combined U1 filament type/colour command.
- **v0.11.0 file-centric automatic queue:**
  - persistent controller-side staged queue files with SHA-256;
  - bounded G-code requirement extraction for tools/material/colour/nozzle metadata;
  - centralized compatibility/readiness engine with reason codes;
  - automatic printer selection and reservation;
  - U1 logical→physical tool-map generation;
  - staged-file upload and verification only when needed; physical validation confirmed an exact existing printer-local filename is reused without another upload;
  - fresh printer-specific preflight immediately before start;
  - restart-safe automatic upload/preflight recovery;
  - cancellation-race protection;
  - queue UI showing Eligible / Waiting / Needs review / Not compatible;
  - fixed-printer jobs retained for backward compatibility.
- v0.11.0 regression suite: **100 passing tests, 0 failures**, including GitHub Actions verification of the release patch.
- **v0.11.1 FlashForge nozzle designation:** persistent per-printer controller nozzle diameter, normalized into FlashForge tool status and enforced by file-centric automatic queue compatibility; explicit nozzle matches can run unattended and mismatches are blocked.
- v0.11.1 regression suite: **105 passing tests, 0 failures**, including GitHub Actions verification.
- **v0.11.2 neutral data directory:** default controller storage no longer contains `FlashForge`; existing printer registry, queue/history, staged queue files, and metadata migrate automatically to the new manufacturer-neutral directory.
- v0.11.2 regression suite: **106 passing tests, 0 failures**, including an end-to-end legacy-directory migration test in GitHub Actions.
- **v0.11.3 staged-file cleanup:** clearing print history immediately removes controller-staged queue files that have no remaining queue/history reference; shared/referenced files are retained.
- **v0.12.0 production quantity / batch printing:** one staged G-code can create 2–999 run records sharing the same file; automatic scheduling can distribute copies across multiple compatible printers concurrently, with batch progress, pause/resume, cancel remaining, and safe quantity adjustment. Physical validation confirmed a completed printer remains blocked until **Bed cleared** before receiving the next batch copy. It also confirmed pausing prevents new copies from starting while active prints continue and resuming restarts scheduling; **Cancel remaining** cancels all waiting/preparing copies while currently active prints continue; and requested quantities can be safely increased or decreased while copies are waiting without removing copies that have already started or finished.
- v0.12.0 regression suite: **113 passing tests, 0 failures**, including concurrent assignment plus pause/cancel race coverage during staged upload.
- **v0.12.1 cancelled-history reprint regression:** automated coverage now guarantees a cancelled automatic queued job remains reprintable from Recent history using the same staged controller file and print options; UI coverage verifies cancelled history retains the Reprint action.
- v0.12.1 regression suite: **115 passing tests, 0 failures**.
- **v0.12.2 production batch reprint:** finished production batches in Recent history expose **Reprint batch**, creating a fresh automatic batch with the same quantity, staged controller file and print options while preserving the original history.
- v0.12.2 regression suite: **117 passing tests, 0 failures**.
- **v0.12.3 individual printer upload:** supported printer detail windows expose **Upload file**; uploads are adapter-extension-aware, use the existing verified file-distribution path for one target printer, persist available material metadata, and refresh the printer file list after success.
- v0.12.3 regression suite: **119 passing tests, 0 failures**.
- **v0.12.4 FlashForge filament colour designation:** FlashForge printer detail controls now persist both material type and `#RRGGBB` filament colour; the assigned colour is normalized into tool status and participates in automatic queue compatibility/mismatch blocking.
- **v0.12.5 Snapmaker RGB colour display:** U1 filament colours are shown as both `#RRGGBB` and `RGB(r, g, b)` in toolhead metadata, print setup physical-head choices, and material preflight.
- v0.12.5 regression suite: **121 passing tests, 0 failures**.
- **v0.12.6 Snapmaker RGB toolhead layout:** U1 toolhead status keeps the hexadecimal colour on the metadata line and renders `RGB(r, g, b)` on a separate line to prevent overflow; print setup and material preflight retain combined hex + RGB text.
- **v0.12.7 FlashForge RGB colour display:** controller-assigned FlashForge filament colours now show the stored `#RRGGBB` value plus `RGB(r, g, b)` in Toolhead status; queue compatibility semantics are unchanged.
- **v0.12.15 production batch control layout:** Pause/Resume, priority, quantity and cancellation controls use a dedicated responsive row below the copy list instead of sharing its grid row.
- **v0.12.16 combined Snapmaker filament configuration:** each U1 toolhead card has one type dropdown, colour picker, and **Set filament on U1** button for idle, loaded, editable third-party filament. One `SET_PRINT_FILAMENT_CONFIG` command sends `VENDOR=generic`, `FILAMENT_TYPE`, `FILAMENT_SUBTYPE=generic`, and `FILAMENT_COLOR_RGBA`; the controller verifies all values and keeps official RFID filament locked. Physical U1 testing confirmed the combined control works correctly.
- **v0.12.14 queue priorities and printer selection:** persistent High/Normal/Low priority for individual jobs and production batches, six-hour anti-starvation promotion, manual-order tie-breaking, verified-existing-file preference, and visible printer-selection reasoning.
- **v0.12.13 light/dark appearance modes:** the header exposes an accessible theme switch; the choice persists in the browser, while first use follows the operating-system colour preference.
- **v0.12.12 new-job progress isolation:** retained filename and 100% telemetry are ignored while a queued job is starting; an active matching print state must confirm the new run before its progress is recorded, including same-file reprints.
- **v0.12.11 FlashForge cancellation display:** a latched raw `CANCEL` state displays as Cancelled while clearance is pending and Ready after acknowledgement; raw status remains available in printer detail diagnostics.
- **v0.12.10 FlashForge cancellation queue fix:** persistent `CANCEL`/cancelled/stopped states and retained filenames are handled as terminal only after a bed-clearance acknowledgement; untracked external cancellations also create the clearance interlock.
- **v0.12.9 Snapmaker completed-print queue fix:** explicit idle/complete printer state now takes precedence over Moonraker's retained previous filename, while the independent bed-clearance interlock remains enforced.
- **v0.12.8 native Snapmaker filament colour editing:** manually assigned third-party U1 filament colours can be changed from each toolhead card using stock `SET_PRINT_FILAMENT_CONFIG`; writes are idle/loaded/editable-only and verified against `print_task_config.filament_color_rgba`. Official RFID filament remains colour-locked. Physical U1 testing confirmed that third-party colour changes reach the touchscreen and official RFID colours remain locked.
- v0.12.12 regression suite: **131 passing tests, 0 failures**.
- v0.12.13 regression suite: **132 passing tests, 0 failures**.
- v0.12.14 regression suite: **137 passing tests, 0 failures**. Priority ordering and progress display were also confirmed in the running interface.
- v0.12.15 regression suite: **138 passing tests, 0 failures**. The corrected production-batch layout was also confirmed in the running interface.
- v0.12.16 regression suite: **142 passing tests, 0 failures**.

## Current task

**Experimental X1C support is implemented on `feature/bambu-x1c-v0130`, based on the P1/AMS work.** Status, FTPS files, print/job/temperature/fan control, 3MF mapping, automatic queueing and zero-to-four AMS emulation work through the shared Bambu adapter. The add-printer form uses controlled P1P/P1S/X1C model choices and switches the default camera port for X1C. Physical X1C RTSPS/H.264 camera decoding is explicitly out of scope for this first pass. This branch and its Bambu/emulator parents have not been merged to `main`.

## Next steps

1. Run the controller and emulator together, add the displayed X1C endpoint, and validate status, storage, direct printing, automatic queueing, AMS mapping, temperatures, fans, completion and clearance behavior.
2. Compare telemetry, FTPS behavior and `project_file` start payloads against reliable captures or physical X1C hardware before removing the experimental label or merging to `main`.
3. Decide whether to add an optional native dependency/transcoder for X1C RTSPS/H.264 camera support without compromising the controller's dependency-free default installation.

## Handoff rule

If chat context and this file disagree about the codebase, inspect current GitHub files and tests. **GitHub is authoritative for code; this document is authoritative for project intent/status until deliberately updated.**
