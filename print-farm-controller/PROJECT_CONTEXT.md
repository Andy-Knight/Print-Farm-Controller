# Printer Fleet Controller — Project Context

> Cross-chat handoff file. Read this first when continuing the project in a new chat. Keep it concise and update it whenever architecture/decisions change, a task is completed, or the current/next task changes.

## Source of truth

- Repository: `Andy-Knight/Print-Farm-Controller`
- Project path: `print-farm-controller/`
- Branch: `feature/snapmaker-u1-filament-type-v01216` (from `main`; intended production v0.12.16)
- Current application version: **0.12.16**
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

## Completed work / current baseline

- FlashForge Adventurer 5M / 5M Pro support.
- Snapmaker U1 support via Moonraker/Klipper, including stock camera integration.
- Automatic/local discovery, persistent printer registry and controller-side printer renaming.
- Dashboard ordering, SSE fleet state, diagnostics and batch actions.
- Verified file distribution and printer-local file operations.
- Persistent queue/history/reprint/review states and bed-clearance safety interlock.
- Material metadata/preflight for FlashForge and multi-tool print setup/preflight for U1.
- U1 tool mapping, print preferences, material/nozzle readiness and XYZ offset calibration.
- Bed-powered timed chamber preheat and applicable fan/purifier controls.
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
- **v0.12.16 combined Snapmaker filament configuration:** each U1 toolhead card has one type dropdown, colour picker, and **Set filament on U1** button for idle, loaded, editable third-party filament. One `SET_PRINT_FILAMENT_CONFIG` command sends `VENDOR=generic`, `FILAMENT_TYPE`, `FILAMENT_SUBTYPE=generic`, and `FILAMENT_COLOR_RGBA`; the controller verifies all values and keeps official RFID filament locked.
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

**v0.12.16 Snapmaker U1 combined third-party filament type and colour control is implemented and awaiting physical U1 validation.** Verify that one button updates both values on the U1 touchscreen and that official RFID toolheads remain disabled.

## Next steps

1. On an idle U1 with third-party filament loaded, choose a filament type and colour, press **Set filament on U1**, and confirm the touchscreen shows both new values.
2. Confirm the controller disables type editing for official Snapmaker RFID filament.
3. Queue a file requiring the selected material and confirm automatic compatibility uses the updated type.

## Handoff rule

If chat context and this file disagree about the codebase, inspect current GitHub files and tests. **GitHub is authoritative for code; this document is authoritative for project intent/status until deliberately updated.**
