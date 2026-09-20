# Printer Fleet Controller — Project Context

> Cross-chat handoff file. Read this first when continuing the project in a new chat. Keep it concise and update it whenever architecture/decisions change, a task is completed, or the current/next task changes.

## Source of truth

- Repository: `Andy-Knight/Print-Farm-Controller`
- Project path: `print-farm-controller/`
- Primary branch: `main` (current production baseline)
- Current application version on this branch: **0.14.8**
- v0.14.8 signed licensing and production hardening are merged into `main`; `feature/licensing-foundation` and `feature/licensing-production-hardening` currently point at the same commit as `main`.
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
        +-- signed licence loader / verifier / edition + printer-slot enforcement
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
- The development printer simulator is integrated into the controller lifecycle and UI, but its virtual protocol endpoints remain loopback-only. It is disabled by default, remembers explicit enablement, and exercises production adapters through network protocols rather than bypassing the adapter boundary. Simulator-only support never counts as physical hardware validation. The standalone emulator command remains available for development.
- Bambu P1P/P1S/X1C support remains explicitly experimental until the MQTT telemetry/commands and FTPS behavior are compared with physical printers. P1 TLS/JPEG camera framing also requires physical validation. X1C uses RTSPS/H.264 on port 322; the controller deliberately reports X1C camera as unsupported until a suitable decoder is implemented. Manual entry is used; Bambu LAN discovery is not yet implemented.
- Bambu AMS support models each AMS tray and the external spool as a material source, separate from the P1's single physical nozzle. Automatic scheduling maps logical 3MF filaments to unique live sources, while multi-material raw G-code is rejected because it does not carry the project-level AMS mapping required by the print command.
- Production licensing is offline and Ed25519-signed. The controller ships trusted public verification keys only; production private keys live only in the separate private `Andy-Knight/Print-Farm-Licensing` application.
- No valid signed licence means Community Edition. Current physical-printer allowances are Community 2, Pro 10, Farm 25; simulator printers do not consume licence slots.
- Reducing the allowance never deletes configured printers. Over-limit fleets retain all printers and require selection of the physical printers that occupy active licence slots.
- The signed licence file defaults to `<application directory>/license.json`; the previous data-directory location remains accepted temporarily for migration, with the application-directory file taking priority.
- Production startup must not allow environment-variable licence bypasses. `PRINT_CONTROLLER_EDITION` and arbitrary public-key trust are ignored unless source/test code explicitly enables the internal development override path.
- Licence installation/replacement reloads the signed licence immediately; a normal controller restart is not required.
- The edition entitlement catalogue exists for future feature-by-feature enforcement. As of v0.14.8 the production enforcement path includes signature/expiry validation and physical-printer slot limits; do not describe every entitlement as fully gated unless the code has actually been wired to enforce it.

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
- **v0.12.8 native Snapmaker filament colour editing:** manually assigned third-party U1 filament colours can be changed from each toolhead card using stock `SET_PRINT_FILAMENT_CONFIG`; writes are idle/loaded/editable-only and verified against `print_task_config.filament_color_rgba`. Official RFID filament remains colour-locked. Physical U1 testing confirmed that third-party colour changes reach the touchscreen and official RFID colours remain locked.
- **v0.12.9 Snapmaker completed-print queue fix:** explicit idle/complete printer state now takes precedence over Moonraker's retained previous filename, while the independent bed-clearance interlock remains enforced.
- **v0.12.10 FlashForge cancellation queue fix:** persistent `CANCEL`/cancelled/stopped states and retained filenames are handled as terminal only after a bed-clearance acknowledgement; untracked external cancellations also create the clearance interlock.
- **v0.12.11 FlashForge cancellation display:** a latched raw `CANCEL` state displays as Cancelled while clearance is pending and Ready after acknowledgement; raw status remains available in printer detail diagnostics.
- **v0.12.12 new-job progress isolation:** retained filename and 100% telemetry are ignored while a queued job is starting; an active matching print state must confirm the new run before its progress is recorded, including same-file reprints.
- v0.12.12 regression suite: **131 passing tests, 0 failures**.
- **v0.12.13 light/dark appearance modes:** the header exposes an accessible theme switch; the choice persists in the browser, while first use follows the operating-system colour preference.
- v0.12.13 regression suite: **132 passing tests, 0 failures**.
- **v0.12.14 queue priorities and printer selection:** persistent High/Normal/Low priority for individual jobs and production batches, six-hour anti-starvation promotion, manual-order tie-breaking, verified-existing-file preference, and visible printer-selection reasoning.
- v0.12.14 regression suite: **137 passing tests, 0 failures**. Priority ordering and progress display were also confirmed in the running interface.
- **v0.12.15 production batch control layout:** Pause/Resume, priority, quantity and cancellation controls use a dedicated responsive row below the copy list instead of sharing its grid row.
- v0.12.15 regression suite: **138 passing tests, 0 failures**. The corrected production-batch layout was also confirmed in the running interface.
- **v0.12.16 combined Snapmaker filament configuration:** each U1 toolhead card has one type dropdown, colour picker, and **Set filament on U1** button for idle, loaded, editable third-party filament. One `SET_PRINT_FILAMENT_CONFIG` command sends `VENDOR=generic`, `FILAMENT_TYPE`, `FILAMENT_SUBTYPE=generic`, and `FILAMENT_COLOR_RGBA`; the controller verifies all values and keeps official RFID filament locked. Physical U1 testing confirmed the combined control works correctly.
- v0.12.16 regression suite: **142 passing tests, 0 failures**.
- **v0.13.0 printer simulator:** controller-managed lifecycle, controller-hosted responsive management UI sharing the controller's visual system and persisted light/dark preference, disabled-by-default persisted enablement, and loopback-only protocol endpoints; multiple dynamically allocated virtual printers; production-adapter-compatible FlashForge HTTP/TCP/MJPEG camera and Snapmaker Moonraker/WebSocket/snapshot endpoints; experimental Bambu Lab P1P/P1S/X1C TLS MQTT status/control, implicit FTPS file transfer and authenticated camera test endpoints; a visible simulated-camera test frame; virtual files, print progress, temperatures and material/nozzle state; accelerated time; activity logs; repeatable scenarios; and fault injection for offline/delay/rejection/malformed response/verification/cancellation/filename/camera conditions. The standalone development command remains available. The X1C test camera intentionally does not emulate physical RTSPS/H.264. Bambu protocol behaviour is simulator-only and awaits physical hardware validation. FlashForge connection forms now expose configurable HTTP, TCP and camera ports while retaining physical-printer defaults.
- v0.13.0 regression suite: **166 passing tests, 0 failures**, including integrated simulator persistence/routes/lifecycle, standalone management API, authenticated Bambu P1P/P1S/X1C LAN endpoints, full production Bambu P1S and X1C adapter integration against the live simulator, controlled Bambu model selection, editable zero-to-four-unit AMS simulation, live-refresh-safe AMS material/colour controls, embedded 3MF requirement parsing, interactive and automatic AMS material mapping, queue-to-print mapping propagation, credential-safe Bambu persistence, production Snapmaker and FlashForge adapter integration, and the combined U1 filament type/colour command.
- **v0.14.8 signed licensing:** offline Ed25519 verification of `license.json`; Community/Pro/Farm editions with signed independent `maxPrinters`; simulator printers excluded from physical-printer usage; over-limit fleet slot selection without deleting configured printers; controller UI for installing/replacing licences; application-directory licence precedence with legacy data-directory fallback; expired/tampered/untrusted licences fail closed to Community.
- **v0.14.8 production hardening:** normal production startup ignores `PRINT_CONTROLLER_EDITION`, `PRINT_CONTROLLER_LICENSE_PUBLIC_KEY_FILE`, and arbitrary key-ID trust as privilege-escalation mechanisms; `LicenseManager` defaults to Community; the production server does not enable the internal development override gate.
- **v0.14.8 validation completed:** full automated test suite passed with 0 failures; manual Community, Pro and Farm licence activation passed; environment-bypass attempts remained blocked; genuine licence install/replace worked without restart; tampered licences were rejected; simulator printers did not consume slots; over-limit physical-printer selection behaved correctly; general dashboard/printer/files/queue/camera/temperature regression checks passed.

## Current task

**v0.14.8 is merged into `main` and is the current production baseline.** Signed licensing and production hardening have completed their release-gate testing.

The licensing feature branches currently match `main` and can be treated as historical development branches unless a future change deliberately reuses them.

Bambu P1P/P1S/X1C support remains explicitly experimental. Physical X1C RTSPS/H.264 camera decoding remains out of scope until a suitable implementation is added.

## Next steps

1. Continue normal controller development from `main`.
2. Add systematic feature-by-feature entitlement gates only where product packaging requires them; preserve the signed licence format and existing edition definitions.
3. When rotating production signing keys, add the new **public** key to `src/licensing/trusted-public-keys.json` and release a controller build before issuing production licences with that new key ID. Retain older trusted public keys while licences signed by them remain supported.
4. Continue physical validation of experimental Bambu behaviour before removing the experimental designation.

## Handoff rule

If chat context and this file disagree about the codebase, inspect current GitHub files and tests. **GitHub is authoritative for code; this document is authoritative for project intent/status until deliberately updated.**

## Licensing baseline (v0.14.8)

The controller verifies offline Ed25519-signed `license.json` files.

Current trusted production key ID:

```text
primary-2026
```

The controller contains only public verification keys. Private-key handling, customer records and licence generation live in the separate private repository:

```text
Andy-Knight/Print-Farm-Licensing
```

Default licence location:

```text
<application directory>/license.json
```

Licence-file lookup order:
1. `PRINT_CONTROLLER_LICENSE_FILE` explicit file override, when deliberately configured.
2. Application-directory `license.json`.
3. Legacy application-data-directory `license.json` for migration compatibility.
4. No file -> Community Edition.

Signed editions:
- Community: 2 physical printers
- Pro: 10 physical printers
- Farm: 25 physical printers
- Development: unrestricted internal development mode only

Simulator printers do not consume licence slots. If configured physical printers exceed the signed allowance, all printer definitions remain saved and visible; the permitted number are selected as active licence slots.

The signed payload can carry edition, `maxPrinters`, licence type/dates and additional feature entitlements. `maxPrinters` is independently signed rather than inferred solely from edition.

Current entitlement catalogue:
- `printer.basic_control`
- `printer.file_management`
- `printer.camera`
- `printer.preheat`
- `queue.manual`
- `queue.smart_assignment`
- `queue.job_priority`
- `queue.batch_jobs`
- `fleet.statistics`
- `fleet.maintenance`
- `fleet.history`
- `fleet.multi_operator`
- `automation.bed_clearance`
- `automation.material_matching`
- `automation.nozzle_matching`
- `automation.auto_transfer`
- `automation.failure_recovery`
- `remote.access`
- `remote.notifications`
- `remote.multi_site`

Edition mappings:
- BASIC = basic control, file management, camera, preheat, manual queue
- PRO = BASIC + job priority + statistics + maintenance + history
- FARM = PRO + smart assignment + batch jobs + multi-operator + bed clearance + material/nozzle matching + auto transfer + failure recovery
- development = `*`, unrestricted/noncommercial

As of v0.14.8, do **not** assume every catalogue entry is systematically enforced throughout the UI/API. The release-gated enforcement is signed-licence validity/expiry plus physical-printer slot limits. Extend feature gating deliberately and test each gated surface.

### Production hardening rule

Normal controller startup must not permit an environment-variable licensing bypass.

As of v0.14.8:

- `PRINT_CONTROLLER_EDITION` is ignored in normal production/default loading.
- `PRINT_CONTROLLER_LICENSE_PUBLIC_KEY_FILE` is ignored in normal production/default loading.
- `PRINT_CONTROLLER_LICENSE_KEY_ID` only participates in the explicitly gated development override path.
- `LicenseManager` defaults to Community rather than reading the environment.
- The production server does not enable development licence overrides.
- `loadLicenseManager(..., { allowDevelopmentOverrides:true })` is an internal test/development mechanism only and must never be enabled by the production server.
- Tampered, malformed or untrusted signed licences fail closed to Community.
- Expired subscription licences fail closed to Community without erasing the signed licence identity from status information.
- Installing/replacing a valid licence reloads the active licence immediately and returns `restartRequired:false`.

Do not reintroduce a runtime environment flag that lets a distributed controller activate Pro/Farm/Development or trust an arbitrary signing key without a source/build modification.

### v0.14.8 release validation

Completed before merge to `main`:
- full automated `npm test` suite: passed, 0 failures
- no licence -> Community
- production `PRINT_CONTROLLER_EDITION=farm` bypass attempt -> remained Community
- valid Pro licence -> activated correctly
- restart with valid Pro licence -> remained active
- valid Farm replacement -> activated correctly
- Community replacement -> reduced allowance correctly
- tampered signed payload -> rejected
- simulator printers -> did not consume physical slots
- over-limit fleet -> printer definitions retained; slot selection enforced
- Licence install/replace UI -> valid files accepted and applied without restart
- general dashboard, printer details, file listing/upload, manual print, queue, camera and temperature controls -> regression checked

