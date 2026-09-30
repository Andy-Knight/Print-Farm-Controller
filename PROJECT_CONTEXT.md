# Print Farm Controller — Project Context
Cross-chat handoff file. Read this first when continuing the project in a new chat. Keep it concise and update it whenever architecture/decisions change, a task is completed, or the current/next task changes.
 
## Handoff rule

If chat context and this file disagree about the codebase, inspect current GitHub files and tests. **GitHub is authoritative for code; this document is authoritative for project intent/status until deliberately updated.**

## Source of truth
- Repository: `Andy-Knight/Print-Farm-Controller`
- Project path: repository root (`/`)
- Primary branch: `main` (current production baseline)
- Current application version on this branch: **0.33.0**.
- Runtime: **Node.js 24+** (development baseline Node.js 24.21.0), ES modules, no npm runtime dependencies.
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
        +-- persistent Print Library store + cached slicer preview extraction
        +-- compatibility engine
        +-- persistent custom printer groups + overlapping printer membership
        +-- persistent print queue + history + bed-clearance interlock + optional group restriction
        +-- persistent maintenance tasks + printer/group/model assignment + completion history + controller-observed printer usage
        +-- logical `.pfcbackup` backup/recovery + scheduled local/network backups + staged restart restore/rollback
        +-- signed licence loader / verifier / edition + printer-slot enforcement
        |
        v
PrinterAdapter boundary (`src/adapters/`)
        +-- FlashForge Adventurer 5M / 5M Pro -> HTTP + TCP 8899 + MJPEG camera
        +-- FlashForge Creator 5 / Creator 5 Pro -> modern HTTP-only API + four-tool material station + MJPEG camera
        +-- Snapmaker U1 -> Moonraker / Klipper
        +-- Bambu Lab P1P / P1S / X1C / A1 Mini -> experimental MQTT/FTPS adapter; P1/A1 Mini TLS-JPEG camera

Development Printer Emulator (`emulator/`, loopback only)
        +-- management UI/API + SSE
        +-- shared virtual-printer state and scenarios
        +-- FlashForge AD5M HTTP/TCP/camera endpoints
        +-- FlashForge Creator 5 / Creator 5 Pro HTTP-only/camera endpoints
        +-- Snapmaker U1 Moonraker endpoints
        +-- Bambu P1P/P1S/X1C/A1 Mini MQTT TLS, FTPS TLS and camera test endpoints
```

Manufacturer-specific discovery, capabilities, limits, status normalization, files, print control, temperatures and camera selection belong behind the adapter boundary. Core fleet services should remain manufacturer-agnostic.

## Important decisions

- Local-first/LAN-only controller; printer credentials remain backend-side.
- Multiple manufacturers are supported through adapters rather than manufacturer logic in shared fleet code.
- Creator 5-series support uses a separate `flashforge-creator5` adapter rather than extending the AD5M adapter. Creator 5/Pro share the modern authenticated FlashForge HTTP API but do not expose the legacy TCP 8899 file/control service and have four physical toolheads/material slots, so inheriting AD5M single-tool/TCP assumptions would be unsafe. Creator 5 discovery PIDs are 40 (Creator 5) and 41 (Creator 5 Pro); discovery may still advertise 8899, but the adapter deliberately ignores it.
- Creator 5 printer-local file browsing is recent-only through `/gcodeList`; full storage enumeration and per-file sliced tool requirements are not exposed by the local API. Automatic queue jobs originating from the controller Print Library carry their parsed logical-tool/material/nozzle metadata into compatibility, upload and print-start mapping. For an already-stored printer-local file, the controller warns that it must use the mapping/defaults saved with the file rather than inventing requirements.
- Creator 5 Pro native chamber temperature control is distinct from the controller's generic bed-powered chamber-preheat feature. The Pro exposes a chamber sensor and direct target up to 65 °C; base Creator 5 does not. Creator 5 Pro filtration hardware is not exposed as a writable controller capability because the available local circulation command is ineffective.
- Default persistent controller data now lives in the application-local `data/` directory rather than the operating-system user profile. If `data/` does not yet exist, startup migrates the previous profile-based `Printer Fleet Controller` directory, falling back to the older `FlashForge Fleet` location. This moves printer configuration, queue/history, Print Library files, emulator settings and file material metadata together. Custom `DATA_DIR` locations are used exactly as configured and are never moved.
- Print Library files, queue/history and their references persist across restarts. Queue/history cleanup never owns library-file deletion.
- Printer groups are controller-owned and manufacturer-agnostic. A printer may belong to zero, one or multiple groups at the same time; editing one group changes only that group's membership. Group membership is not part of printer connection/adaptor configuration.
- Automatic queue work may optionally carry a printer-group restriction. The controller evaluates only current members of that group for assignment, and group membership changes trigger queue reevaluation. The group restriction narrows the candidate set but does not bypass model/file targeting, material/colour/nozzle compatibility, licensing, busy state, bed clearance, concurrency or any other safety/preflight rule.
- Maintenance task assignment supports three scopes: individual printer, custom printer group, and printer model. Group-wide rules follow current group membership while maintaining independent per-printer assignment state, recurrence baseline, last-completed data and history.
- Maintenance tracking is a controller-owned fleet service keyed by printer ID rather than adapter-specific state. `maintenance.json` stores task definitions, completion history, per-task interval baselines, and controller-observed print seconds/cycles. Observed counters begin when this controller tracks activity and must not be presented as manufacturer lifetime counters. A maintenance task may recur by calendar days, observed print hours, or observed print count; reaching 80% of an interval is **Due soon**, reaching 100% is **Due**. Completing a task creates a retained history entry with notes/usage snapshot before resetting only that task's baseline.
- Backup/recovery uses portable logical `.pfcbackup` archives rather than raw `data/` copies. Archives carry a manifest and checksums, include controller configuration/state, printer-group definitions/membership and Print Library content, and exclude logs, executables/build artifacts, transient files and private licensing keys. Older backups without `printer-groups.json` restore with an empty group store.
- Restore is two-phase and restart-activated: inspect/validate/migrate/stage while the live installation stays intact, then activate before normal services initialize. Activation retains rollback state and automatically restores it if startup validation fails. Restored unfinished queue work is recovery-held, restored production batches remain paused, transient reservations/start state is cleared, and existing/required bed-clearance interlocks are preserved until deliberate user review.
- Print Library previews are derived from slicer-provided images only: Orca/Bambu-style 3MF plate thumbnails and supported embedded PNG/JPEG G-code thumbnail blocks. Cached preview images live beside the stored print file; unsupported/missing thumbnails use a UI placeholder rather than a generated render.
- A completed/active-failed/cancelled print creates a **bed-clearance interlock**; no later queued job may start on that printer until **Bed cleared** is confirmed.
- Queue jobs support two assignment modes: **fixed printer** and **Next available compatible printer**.
- Automatic scheduling is file-centric: the controller references a durable Print Library entry, evaluates compatibility/readiness, reserves one printer, uploads/verifies if required, performs a fresh live preflight, then starts.
- Compatibility and readiness are distinct. A printer may be compatible but temporarily blocked by offline/busy/bed-clearance/reservation state.
- Automatic compatibility returns explicit per-printer reasons and distinguishes **Eligible**, **Waiting**, **Needs review**, and **Not compatible**.
- Required nozzle size must not be guessed. If a printer cannot report an explicitly required nozzle, unattended scheduling requires review rather than assuming a match.
- U1 logical-to-physical tool mapping is derived from live material/colour/nozzle state and uses constrained matching to avoid greedy mapping errors.
- Colour compatibility is semantic rather than exact-hex: normalized slicer/printer colours must resolve to the same colour family for unattended scheduling, while original printer/slicer hex values are retained where available and CIELAB distance is used only to prefer the closest shade among otherwise-valid candidates. FlashForge controller-side manual designation uses a required family only. Editable/non-RFID U1 filament configuration and simulated Bambu AMS/AMS Lite/external-spool configuration use the canonical family list and translate the selected family to a representative hex internally. Real Bambu tray metadata remains printer-reported and is classified into the same families. Material and nozzle requirements remain strict.
- Production batches share one Print Library file across multiple run records. Pausing prevents not-yet-started copies from progressing, while active prints continue; cancelling remaining copies also catches copies still in upload/preflight without cancelling prints that have already started.
- Existing fixed-printer queue behaviour remains backward compatible.
- The Print Library is the durable source of controller-owned G-code/GX/3MF files. Library entries store filename, size, SHA-256, added timestamp and parsed print requirements; duplicate content reuses the existing entry.
- Historical `queue-files/` directories migrate automatically to `print-library/` while keeping the same UUID directories, preserving existing queue/history references.
- Library files are deleted only by an explicit library delete action, and deletion is blocked while any current queue/history record still references the entry.
- Every delivered version increments the application version and updates README/context.
- **README/CHANGELOG documentation split:** the user-facing README now keeps only the current release summary and operational documentation. Historical per-version notes have moved to `CHANGELOG.md`, which preserves the release history while keeping the README focused on installation, configuration, supported hardware and use.
- The browser appearance switch is accessible, persists only in browser `localStorage`, and follows the device colour scheme until the user explicitly selects Light or Dark.
- **Live-telemetry edit protection rule:** if a UI field is both refreshed from live printer telemetry and user-editable, and the user's change requires a separate **Save / Apply / Set** action, the UI must treat the edit as pending/dirty and must not let telemetry overwrite the user's unsaved value. Clear the dirty state only after the write succeeds (or the control is intentionally rebuilt/cancelled). The Snapmaker U1 filament type/colour editor is the current reference implementation. Controls that save immediately on selection, or controls that are not rewritten by telemetry, do not need this protection.
- Queue priority is **High / Normal / Low**. Effective priority ranks before manual queue order; a waiting job gains one priority level every six hours so low-priority work cannot be starved. Within the same effective priority, manual order remains authoritative.
- When multiple compatible idle printers are ready for an automatic job, a printer with a verified existing copy of the file is preferred; the assigned job records the selection reason.
- The development printer simulator is integrated into the controller lifecycle and UI, but its virtual protocol endpoints remain loopback-only. It is disabled by default, remembers explicit enablement, and exercises production adapters through network protocols rather than bypassing the adapter boundary. Simulator-only support never counts as physical hardware validation. The standalone emulator command remains available for development.
- Bambu P1P/P1S/X1C/A1 Mini support remains explicitly experimental until MQTT telemetry/commands, FTPS behavior, material mapping and camera behavior are compared with physical printers. P1P/P1S/A1 Mini use the TLS/JPEG camera path on port 6000. X1C uses RTSPS/H.264 on port 322; the controller deliberately reports X1C camera as unsupported until a suitable decoder is implemented. Manual entry is used; Bambu LAN discovery is not yet implemented.
- Bambu AMS support models each AMS/AMS Lite tray and the external spool as a material source, separate from the printer's single physical nozzle. Automatic scheduling maps logical 3MF filaments to unique live sources, while multi-material raw G-code is rejected because it does not carry the project-level mapping required by the print command.
- Production licensing is offline and Ed25519-signed. The controller ships trusted public verification keys only; production private keys live only in the separate private `Andy-Knight/Print-Farm-Licensing` application.
- No valid signed licence means Community Edition. Current physical-printer allowances are Community 3, Pro 10, Farm 25; simulator printers do not consume licence slots.
- Reducing the allowance never deletes configured printers. Over-limit fleets retain all printers and require selection of the physical printers that occupy active licence slots.
- Source/development and packaged SEA modes both keep the signed licence at `<DATA_DIR>/license.json` (default `<application directory>/data/license.json`). A valid older application-root `license.json` is verified and automatically migrated into the data directory; invalid/tampered legacy files are not promoted.
- Production startup must not allow environment-variable licence bypasses. `PRINT_CONTROLLER_EDITION` and arbitrary public-key trust are ignored unless source/test code explicitly enables the internal development override path.
- Licence installation/replacement reloads the signed licence immediately; a normal controller restart is not required.
- The edition entitlement catalogue exists for future feature-by-feature enforcement. As of v0.14.8 the production enforcement path includes signature/expiry validation and physical-printer slot limits; do not describe every entitlement as fully gated unless the code has actually been wired to enforce it.

## Current baseline

- Supported printers: FlashForge Adventurer 5M / 5M Pro, FlashForge Creator 5 / Creator 5 Pro, Snapmaker U1, and experimental Bambu Lab P1P / P1S / X1C / A1 Mini support.
- Persistent printer registry with manufacturer-specific adapters, local discovery where supported, controller-side printer naming, live SSE fleet state, dashboard filtering and printer groups with overlapping membership.
- Persistent Print Library with descriptions, previews, target-printer metadata, material/colour/nozzle requirements, verified file distribution and queue integration.
- Persistent print queue/history with fixed-printer or next-compatible-printer assignment, priorities, production batches, reprint, compatibility/preflight checks, material/tool mapping and bed-clearance interlocks.
- Maintenance tracking supports printer-, group- and model-scoped recurring tasks, due-soon/due status, per-printer history and controller-observed print usage.
- Backup & recovery on the production baseline uses portable verified/compressed `.pfcbackup` archives with local/NAS, Google Drive and generic S3-compatible destinations, scheduled backups, explicit inspection, staged restart restore, rollback and recovery holds for unfinished queue work. Microsoft OneDrive is being reconciled on top of that baseline for v0.36.0.
- Google Drive production deployments use the shared built-in OAuth configuration injected at build time; customers authorize their own Google account without supplying an OAuth client. Advanced custom OAuth remains available for source/development or bespoke deployments.
- Offline Ed25519-signed licensing enforces physical-printer allowances: Community 3, Pro 10 and Farm 25; simulator printers do not consume licence slots.
- Integrated printer simulator covers FlashForge, Snapmaker and experimental Bambu protocol paths for repeatable development and automated validation.
- Production deployment supports the hardened Windows x64 Node SEA/installer path and the multi-architecture GHCR container image for `linux/amd64` and `linux/arm64`, with persistent `/data` and `/logs`.
- Known validation limits: Creator 5 / Creator 5 Pro physical-hardware validation remains incomplete; Bambu support remains experimental; X1C RTSPS/H.264 camera streaming is not currently supported.

## Current task

The current production baseline is **v0.35.0** on `main`. Generic S3-compatible backup and restore are merged, with automated MinIO integration, container smoke and multi-architecture image validation passing. Google Drive remains production-validated from a deployed container.

The active feature branch is **`feature/onedrive-backup-v0340` / draft PR #59**, now reconciled against v0.35.0 and advanced to **v0.36.0**. The reconciled branch preserves Google Drive and the complete S3 provider while adding Microsoft OneDrive as another cloud provider. Shared scheduler, restore-provider registry, UI, packaging and test coverage now support Google Drive, OneDrive and S3 together.

The original OneDrive branch was developed as v0.34.0 before S3 merged. After v0.35.0 became the production baseline, PR #59 was rebuilt from current `main` and the OneDrive changes were reapplied as v0.36.0 to avoid downgrading or overwriting S3 work.

Real Microsoft account/Graph validation remains pending because Microsoft account creation for the test account is currently blocked. Automated OneDrive regression coverage and production packaging validation remain the release gate available without a live Microsoft account.

## Next steps

1. Complete final v0.36.0 CI after the OneDrive/S3 reconciliation and documentation update.
2. When Microsoft account creation becomes available, create/configure the Entra public-client application and validate OneDrive connect, manual backup, scheduled backup/retention, listing/inspection and staged restore against a real account.
3. Validate S3 manually against a deployed/local MinIO or external S3-compatible service in addition to the automated MinIO CI coverage already passing.
4. Validate the built-in Google OAuth flow in the packaged Windows SEA/installer build.
5. Physically validate FlashForge Creator 5 / Creator 5 Pro support and continue experimental Bambu validation.

## Licensing baseline

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
- all normal deployments: `<DATA_DIR>/license.json`
- default source/development and packaged SEA path: `<application directory>/data/license.json`

Normal production licence-file lookup order:
1. Canonical `<DATA_DIR>/license.json`.
2. Previous application-root `license.json` only as a verified one-time migration source.
3. No file -> Community Edition.

`PRINT_CONTROLLER_LICENSE_FILE` is ignored by normal production startup and remains available only behind the explicit internal development-override gate.

Signed editions:
- Community: 3 physical printers
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
- Community = basic control, file management, camera, preheat, manual queue
- Pro = Community feature set + job priority + statistics + maintenance + history
- Farm = Pro feature set + smart assignment + batch jobs + multi-operator + bed clearance + material/nozzle matching + auto transfer + failure recovery
- Development = `*`, unrestricted/noncommercial

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

## Version history

### v0.11.0

- **File-centric automatic queue:**
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

- Regression suite: **100 passing tests, 0 failures**, including GitHub Actions verification of the release patch.

### v0.11.1

- **FlashForge nozzle designation:** persistent per-printer controller nozzle diameter, normalized into FlashForge tool status and enforced by file-centric automatic queue compatibility; explicit nozzle matches can run unattended and mismatches are blocked.

- Regression suite: **105 passing tests, 0 failures**, including GitHub Actions verification.

### v0.11.2

- **Neutral data directory:** default controller storage no longer contains `FlashForge`; existing printer registry, queue/history, staged queue files, and metadata migrate automatically to the new manufacturer-neutral directory.

- Regression suite: **106 passing tests, 0 failures**, including an end-to-end legacy-directory migration test in GitHub Actions.

### v0.11.3

- **Staged-file cleanup:** clearing print history immediately removes controller-staged queue files that have no remaining queue/history reference; shared/referenced files are retained. Historical only; v0.15.0 supersedes this lifecycle with explicit persistent Print Library deletion.

### v0.12.0

- **Production quantity / batch printing:** one staged G-code can create 2–999 run records sharing the same file; automatic scheduling can distribute copies across multiple compatible printers concurrently, with batch progress, pause/resume, cancel remaining, and safe quantity adjustment. Physical validation confirmed a completed printer remains blocked until **Bed cleared** before receiving the next batch copy. It also confirmed pausing prevents new copies from starting while active prints continue and resuming restarts scheduling; **Cancel remaining** cancels all waiting/preparing copies while currently active prints continue; and requested quantities can be safely increased or decreased while copies are waiting without removing copies that have already started or finished.

- Regression suite: **113 passing tests, 0 failures**, including concurrent assignment plus pause/cancel race coverage during staged upload.

### v0.12.1

- **Cancelled-history reprint regression:** automated coverage now guarantees a cancelled automatic queued job remains reprintable from Recent history using the same staged controller file and print options; UI coverage verifies cancelled history retains the Reprint action.

- Regression suite: **115 passing tests, 0 failures**.

### v0.12.2

- **Production batch reprint:** finished production batches in Recent history expose **Reprint batch**, creating a fresh automatic batch with the same quantity, staged controller file and print options while preserving the original history.

- Regression suite: **117 passing tests, 0 failures**.

### v0.12.3

- **Individual printer upload:** supported printer detail windows expose **Upload file**; uploads are adapter-extension-aware, use the existing verified file-distribution path for one target printer, persist available material metadata, and refresh the printer file list after success.

- Regression suite: **119 passing tests, 0 failures**.

### v0.12.4

- **FlashForge filament colour designation:** FlashForge printer detail controls now persist both material type and `#RRGGBB` filament colour; the assigned colour is normalized into tool status and participates in automatic queue compatibility/mismatch blocking.

### v0.12.5

- **Snapmaker RGB colour display:** U1 filament colours are shown as both `#RRGGBB` and `RGB(r, g, b)` in toolhead metadata, print setup physical-head choices, and material preflight.

- Regression suite: **121 passing tests, 0 failures**.

### v0.12.6

- **Snapmaker RGB toolhead layout:** U1 toolhead status keeps the hexadecimal colour on the metadata line and renders `RGB(r, g, b)` on a separate line to prevent overflow; print setup and material preflight retain combined hex + RGB text.

### v0.12.7

- **FlashForge RGB colour display:** controller-assigned FlashForge filament colours now show the stored `#RRGGBB` value plus `RGB(r, g, b)` in Toolhead status; queue compatibility semantics are unchanged.

### v0.12.8

- **Native Snapmaker filament colour editing:** manually assigned third-party U1 filament colours can be changed from each toolhead card using stock `SET_PRINT_FILAMENT_CONFIG`; writes are idle/loaded/editable-only and verified against `print_task_config.filament_color_rgba`. Official RFID filament remains colour-locked. Physical U1 testing confirmed that third-party colour changes reach the touchscreen and official RFID colours remain locked.

### v0.12.9

- **Snapmaker completed-print queue fix:** explicit idle/complete printer state now takes precedence over Moonraker's retained previous filename, while the independent bed-clearance interlock remains enforced.

### v0.12.10

- **FlashForge cancellation queue fix:** persistent `CANCEL`/cancelled/stopped states and retained filenames are handled as terminal only after a bed-clearance acknowledgement; untracked external cancellations also create the clearance interlock.

### v0.12.11

- **FlashForge cancellation display:** a latched raw `CANCEL` state displays as Cancelled while clearance is pending and Ready after acknowledgement; raw status remains available in printer detail diagnostics.

### v0.12.12

- **New-job progress isolation:** retained filename and 100% telemetry are ignored while a queued job is starting; an active matching print state must confirm the new run before its progress is recorded, including same-file reprints.

- Regression suite: **131 passing tests, 0 failures**.

### v0.12.13

- **Light/dark appearance modes:** the header exposes an accessible theme switch; the choice persists in the browser, while first use follows the operating-system colour preference.

- Regression suite: **132 passing tests, 0 failures**.

### v0.12.14

- **Queue priorities and printer selection:** persistent High/Normal/Low priority for individual jobs and production batches, six-hour anti-starvation promotion, manual-order tie-breaking, verified-existing-file preference, and visible printer-selection reasoning.

- Regression suite: **137 passing tests, 0 failures**. Priority ordering and progress display were also confirmed in the running interface.

### v0.12.15

- **Production batch control layout:** Pause/Resume, priority, quantity and cancellation controls use a dedicated responsive row below the copy list instead of sharing its grid row.

- Regression suite: **138 passing tests, 0 failures**. The corrected production-batch layout was also confirmed in the running interface.

### v0.12.16

- **Combined Snapmaker filament configuration:** each U1 toolhead card has one type dropdown, colour picker, and **Set filament on U1** button for idle, loaded, editable third-party filament. One `SET_PRINT_FILAMENT_CONFIG` command sends `VENDOR=generic`, `FILAMENT_TYPE`, `FILAMENT_SUBTYPE=generic`, and `FILAMENT_COLOR_RGBA`; the controller verifies all values and keeps official RFID filament locked. Physical U1 testing confirmed the combined control works correctly.

- Regression suite: **142 passing tests, 0 failures**.

### v0.13.0

- **Printer simulator:** controller-managed lifecycle, controller-hosted responsive management UI sharing the controller's visual system and persisted light/dark preference, disabled-by-default persisted enablement, and loopback-only protocol endpoints; multiple dynamically allocated virtual printers; production-adapter-compatible FlashForge HTTP/TCP/MJPEG camera and Snapmaker Moonraker/WebSocket/snapshot endpoints; experimental Bambu Lab P1P/P1S/X1C TLS MQTT status/control, implicit FTPS file transfer and authenticated camera test endpoints; a visible simulated-camera test frame; virtual files, print progress, temperatures and material/nozzle state; accelerated time; activity logs; repeatable scenarios; and fault injection for offline/delay/rejection/malformed response/verification/cancellation/filename/camera conditions. The standalone development command remains available. The X1C test camera intentionally does not emulate physical RTSPS/H.264. Bambu protocol behaviour is simulator-only and awaits physical hardware validation. FlashForge connection forms now expose configurable HTTP, TCP and camera ports while retaining physical-printer defaults.

- Regression suite: **166 passing tests, 0 failures**, including integrated simulator persistence/routes/lifecycle, standalone management API, authenticated Bambu P1P/P1S/X1C LAN endpoints, full production Bambu P1S and X1C adapter integration against the live simulator, controlled Bambu model selection, editable zero-to-four-unit AMS simulation, live-refresh-safe AMS material/colour controls, embedded 3MF requirement parsing, interactive and automatic AMS material mapping, queue-to-print mapping propagation, credential-safe Bambu persistence, production Snapmaker and FlashForge adapter integration, and the combined U1 filament type/colour command.

### v0.14.8

- **Signed licensing:** offline Ed25519 verification of `license.json`; Community/Pro/Farm editions with signed independent `maxPrinters`; simulator printers excluded from physical-printer usage; over-limit fleet slot selection without deleting configured printers; controller UI for installing/replacing licences; application-directory licence precedence with legacy data-directory fallback; expired/tampered/untrusted licences fail closed to Community.

- **Production hardening:** normal production startup ignores `PRINT_CONTROLLER_EDITION`, `PRINT_CONTROLLER_LICENSE_PUBLIC_KEY_FILE`, and arbitrary key-ID trust as privilege-escalation mechanisms; `LicenseManager` defaults to Community; the production server does not enable the internal development override gate.

- **Validation completed:** full automated test suite passed with 0 failures; manual Community, Pro and Farm licence activation passed; environment-bypass attempts remained blocked; genuine licence install/replace worked without restart; tampered licences were rejected; simulator printers did not consume slots; over-limit physical-printer selection behaved correctly; general dashboard/printer/files/queue/camera/temperature regression checks passed.

- **Release validation:** 
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

### v0.14.9

- **Product branding:** application renamed from **Printer Fleet Controller** to **Print Farm Controller** across the browser UI, runtime messages, simulator wording and documentation. Historical application-data directory names, npm package/service identifiers and the existing browser theme storage key are intentionally retained to preserve upgrades, integrations and saved preferences.

### v0.14.10

- **Button hover feedback:** all enabled buttons gain a hover/focus colour change. Dark mode brightens buttons and light mode slightly darkens them; disabled buttons are unaffected.

### v0.14.11

- **FlashForge emulator material fidelity:** simulated FlashForge `/detail` no longer reports `rightFilamentType` by default. The virtual printer still keeps its internal filament material for simulator state/scenarios, but the production adapter correctly sees no printer-reported material unless the physical protocol actually supplies one. This aligns the designation control with physical AD5M-family behaviour: **Clear designation** when there is no reported material, **Use printer value** only when a value is genuinely reported.

### v0.14.12

- **Snapmaker U1 display naming:** dashboard cards and printer-details diagnostics render the Snapmaker model as **Snapmaker U1** instead of the raw stored model `U1`. Stored configuration and adapter identity remain unchanged.

### v0.15.0

- **Persistent Print Library:** controller-owned print files are promoted from queue-owned staging into a searchable persistent library. Users can add files without queueing them, inspect detected material/nozzle/tool requirements, queue a selected library entry with quantity and priority, and explicitly delete unreferenced files. SHA-256/size deduplication prevents duplicate storage. Existing `queue-files/` entries migrate to `print-library/` without changing IDs. Legacy queue-file module/API contracts remain compatibility aliases, but queue/history cleanup no longer prunes files.

### v0.15.1

- **Print Library colour listing:** when print requirements contain filament colours, library cards list each distinct detected colour with a swatch plus hexadecimal and RGB values.

### v0.15.2

- **Responsive top bar:** Light/Dark remains permanently visible. Printer simulator and Licence live in a compact overflow menu; Fleet operations stays visible on wider layouts and moves into the same overflow at narrower desktop widths. The header switches to a stacked responsive layout before controls become cramped.

### v0.15.3

- **Light-mode offline warning:** Offline and Error printer badges retain the same red warning treatment in Light mode instead of being overridden by the generic light badge colours.

### v0.15.4

- **Print Library descriptions:** library files support optional free-text description/notes (maximum 4000 characters). Notes are persisted in library metadata, displayed on cards, included in search, editable later through **Edit details**, and accepted when a new file is uploaded through either the library or queue workflow.

### v0.15.5

- **Print Library previews:** library files cache slicer-provided preview images when available. 3MF extraction prefers Orca/Bambu plate thumbnails such as `Metadata/plate_1.png`; G-code extraction recognises embedded PNG/JPEG thumbnail blocks and selects the largest supported image. Existing entries are backfilled on first read. The library card shows a compact thumbnail or **No preview** placeholder, and clicking a real thumbnail opens a larger viewer.

### v0.15.6

- **Dashboard filtering:** the top summary cards are interactive filters for all printers, online printers, actively printing printers, and printers needing attention. The active filter is highlighted, live state changes automatically re-evaluate visibility, and printer reordering controls are hidden while a subset is filtered. This build also includes the application-local `data/` storage change, Snapmaker U1 display naming and printer-card hover/focus highlighting.

### v0.16.0

- **Production packaging is merged into `main`** via PR #24 (squash commit `af8d8e493e2f311c1469ed5faddfffc2316ae727`): centralized runtime paths detect source vs Node SEA execution, esbuild produces a CommonJS controller bundle, and the Windows x64 SEA build embeds the controller UI, simulator UI/resources and trusted Ed25519 public verification keys directly into `PrintFarmController.exe`. The Windows installer targets Program Files, leaves the EXE protected, grants standard-user modify permission only to `data/`, and packaged builds store the signed customer licence at `data/license.json`. Inno Setup 7 is the preferred Windows installer compiler (Inno Setup 6 remains supported as a fallback), and optional Authenticode signing workflows are included.

### v0.16.1

- **Dashboard/UI polish is merged into `main`** via PR #25 (squash commit `8936dcf40a75579d6575306d95e3eca79f4508f5`): main-dashboard **Idle** and **Ready** status badges are green in both Dark and Light modes, matching the Printer Simulator's available-state treatment. Print Library thumbnail and enlarged-preview backgrounds use the existing Light-mode colour `#f3f7fa` in both themes. Existing Offline/Error/Pause styling is unchanged.

### v0.17.0

- **Experimental A1 Mini support:** `feature/bambu-a1-mini` extends the Bambu LAN adapter and integrated emulator to A1 Mini, including MQTT status/control, FTPS file operations, TLS/JPEG camera support, AMS Lite material mapping, 80 °C bed limit, 300 °C nozzle limit, no chamber controls, `.3mf` printing, and experimental single-material `.gcode` starts via `gcode_file`; multi-material AMS Lite jobs remain `.3mf`-only and physical A1 Mini validation is still required. Physical A1 Mini validation remains outstanding.


### v0.18.0

- **Concurrent client safety is merged into `main`** via PR #27. The controller coordinates conflicting operations per printer and tracks longer physical workflows such as bed levelling and U1 tool calibration; U1 bed levelling also exposes Homing / Heating / Stabilising / Probing phases and printer-detail errors are surfaced at the top of the printer window.

### v0.19.0

- **Printer activity status messaging is merged into `main`** via PR #28. It generalises the prominent printer-window activity banner beyond the U1 so controller-tracked bed levelling/calibration and chamber preheat are surfaced consistently across supported printer types.

### v0.20.0

- **Diagnostic logging is merged into `main`** via PR #29. It adds controller-wide structured diagnostic logging, an independent application-local `logs/` runtime path with `LOG_DIR` override, log rotation/redaction, menu-based recent-log viewing, temporary verbose DEBUG mode, and sanitized ZIP diagnostic bundles. Windows packaging grants standard users write access to both `data/` and `logs/`.

- Also fixes U1 bed-levelling activity persistence: while the blocking Moonraker levelling request is running, the controller keeps the activity sticky so transient idle-looking polls cannot erase the Homing / Heating / Stabilising / Probing banner. Closing and reopening the printer-detail dialog therefore reconstructs the active levelling status correctly.

### v0.20.1

- **Printer-detail opening reliability is merged into `main`** via PR #30. The printer-detail dialog opens immediately with a loading state before file enumeration completes, stale asynchronous open requests are discarded after close/reopen, and open failures are no longer silent. Dashboard connection errors are rendered below the **Open printer** button so the action buttons remain aligned across printer cards.

### v0.20.2

- **Dashboard click reliability is merged into `main`** via PR #31. Live fleet reconciliation updates existing cards in place and only moves a card when its actual fleet order differs from the DOM, preventing a live status event from detaching an **Open printer** button between pointer-down and click.

### v0.21.0

- **Print Library printer targeting is in the current `main` baseline.** Print Library files can optionally store a canonical target printer adapter/model. The add/edit/queue-upload UI exposes the supported model list; library cards/search and queued jobs show the target; queue compatibility treats a target mismatch as incompatible; and files without a target remain unrestricted.

### v0.22.0

- **Colour-family matching is merged into the current `main` baseline** via PR #33.

### v0.23.0

- **Backup & Recovery is merged into the current `main` baseline via PR #34.** The backup/recovery architecture is defined in `docs/BACKUP_RECOVERY.md`. The target is a portable logical `.pfcbackup` format with manifest/checksums, manual and scheduled local/NAS backup, validated two-phase restore activated on restart with rollback, and explicit recovery holds so unfinished restored queue work can never auto-start. Cloud destinations and built-in encryption are deferred. Queue colour compatibility treats slicer hex values as shade metadata within practical colour families rather than requiring byte-for-byte hex equality. Same-family shades can run automatically; different families remain blocked. FlashForge manual filament designation stores an authoritative colour family only; existing hex-only designations automatically derive their family, and saving a new manual designation clears the legacy shade. FlashForge, editable/non-RFID Snapmaker U1, and simulated Bambu AMS/AMS Lite/external-spool selectors use the same custom family dropdown, with a consistent square swatch rendered inside each option and selected value. Pending U1 filament type/colour edits are protected from live telemetry until the Set filament operation succeeds. The U1 and simulator write representative hex colours internally; official U1 RFID filament and real Bambu tray colours remain printer-reported. U1/AMS candidate mapping prefers the closest compatible shade using CIELAB colour distance without turning shade distance itself into a hard requirement.

### v0.24.0

- **Maintenance tracking is merged into `main`** via PR #35, with the follow-up fixes merged via PR #36.

### v0.25.0

- **Printer groups are merged into `main`** via PR #37.

### v0.25.1

- **Dashboard group filtering and maintenance assignment baseline are merged into `main`** via PR #38 (squash commit `e8530aed5216e5aca58f59a690b7669351bd203e`).

### v0.26.0

- **FlashForge Creator 5 / Creator 5 Pro support is merged into `main`** via PR #39 (squash commit `becb856a2483c87777feff2f1023bf250b77422c`). It adds dedicated FlashForge Creator 5 / Creator 5 Pro support through the modern HTTP-only local API. The family has four physical toolheads/material slots, 320 °C nozzle and 120 °C bed limits, per-tool temperature/status/material telemetry, camera, bed levelling, job control, `.gcode`/`.3mf` upload and automatic four-tool Print Library mapping. Creator 5 Pro additionally exposes its native chamber sensor/target up to 65 °C and now participates in the bounded Chamber Preheat workflow using the native chamber heater (30-65 °C target) rather than the build plate. Native chamber preheat reasserts a cleared target, stops/turns the chamber heater off at timeout or manual stop, and relinquishes heater ownership without forcing it off when a print starts. Creator 5 has no live TCP 8899 endpoint, so printer-local file browsing/verification uses the HTTP recent-file list and does not pretend to provide full storage. Printer-local files do not expose sliced tool metadata; controller-managed Print Library jobs do retain requirements and can be mapped automatically. Creator 5 camera startup now attempts both observed stream-open command spellings before the controller connects to the MJPEG endpoint, which also remains safe on firmware where stream control is a no-op. `matlStationInfo.currentSlot` is treated as a feeding material slot rather than an authoritative active extruder, so active-tool UI is only asserted when exactly one nozzle target is non-zero. Creator 5 Pro filtration remains printer-managed/read-only because the local circulation-control command is documented/observed as ineffective. The Add Printer dialog also has one-click registration for running integrated-simulator printers using each virtual printer's generated `controllerSettings`, eliminating manual entry of dynamic host/port/credential fields. Already-added virtual printers are detected from their simulated adapter/host/port identity. `EmulatorManager.isSimulatedConfig()` explicitly recognises the Creator 5 adapter so virtual Creator 5/Pro printers remain licence-exempt like the other simulator models. Emulator and automated protocol validation are included; physical Creator 5-series validation is pending. The built-in simulator fleet now includes both Creator 5 and Creator 5 Pro in addition to AD5M Pro, U1, P1P, P1S, X1C and A1 Mini. Integrated-simulator printer definitions are persisted in `data/emulator-settings.json` and restored across controller restarts/updates; older settings without definitions can recover already-registered simulated printers from the controller registry. Dashboard summary filters now keep their four button DOM nodes stable during live SSE updates so pointer/click events cannot be lost when fleet telemetry refreshes between pointerdown and click.

### v0.27.0

- **Dashboard static printer imagery is merged into `main`** via PR #40 (`0cd067052b23a944558ceec88762f57409b8ea13`). Dashboard printer cards use eight independent bundled WebP model images rather than live camera snapshots or a shared sprite. Supported artwork covers AD5M Pro, Creator 5, Creator 5 Pro, Snapmaker U1, Bambu P1P, P1S, X1 Carbon and A1 Mini, with a neutral fallback for unknown future models. Images render with `object-fit: contain` on theme-aware Light/Dark image wells. Printer-detail camera streaming remains unchanged and continues to use the live `/camera/stream` endpoint plus the existing Restart camera control. Removing dashboard snapshot polling also reduces camera/network load without removing camera functionality from printer details.

### v0.28.0

- **Multi-group printer membership is merged into `main`** via PR #41 (`8d43d6087978dfbf71ee7b312d2c47e1358427ed`). Printer-group membership is no longer exclusive: one configured printer can belong to multiple custom groups simultaneously. Existing group data remains compatible because membership is already stored on each group. Dashboard filtering, queue group restrictions and group-wide maintenance continue to evaluate each group independently.

### v0.29.0

- **Dashboard filament swatches are merged into `main`** via PR #42 (`16577ed149ea49e1f3e5dcc84ce16d1c685108f8`). Dashboard printer cards overlay loaded or assigned filament colour swatches inside the existing 190 px model-image area, preserving card dimensions and footer alignment. Generic multi-tool printers use live per-tool filament state; Bambu printers use live material-source state for external spool, AMS and AMS Lite. Up to four swatches are shown, with `+N` for additional sources. Hover text identifies source, material, colour and whether the value is controller-assigned, RFID-detected or printer-reported.

### v0.30.0

- **Sharper dashboard printer imagery is merged into `main`** via PR #43 (`55eb8208058e6dad087f1db4209fadf30c538046`). The eight dashboard printer model assets are upgraded from 260×124 to 400×190 transparent WebP images. The 400×190 source resolution matches the dashboard's 190 px-high image well, removing the browser upscaling applied to the older reduced assets while preserving `object-fit: contain`, card dimensions, model mappings, v0.29 filament overlays, Light/Dark backgrounds and printer-detail live cameras. Automated tests validate all eight files as 400×190 VP8X WebP assets.

### v0.30.1

- **Circular dashboard filament swatches are merged into `main`** via PR #44 (`b2715ee4b4d038e6bb62513d04c763bffafa607a`). Dashboard filament colour swatches retain their existing 16×16 px size and overlay layout but use `border-radius: 50%` so they render as circles. Filament-source logic, tooltips, `+N` overflow, card dimensions and theme behaviour are unchanged.

### v0.30.2

- **Long-running memory stability and dashboard filter hierarchy are merged into `main`** via PR #46 (`e35e0c737d73d7322bbcebbc5b5f725923d0a7b6`) and PR #47 (`902415df55c1bcb627f2c528ee19712f25acb52b`). SSE live-event delivery now bounds slow-client buffering to 2 MB, respects backpressure and retains only the newest pending fleet snapshot; completed Bambu MQTT polling sockets are force-closed; Diagnostics reports heap/RSS telemetry and logs escalating memory pressure plus recovery. The Printer group selector is positioned above the dashboard summary/status filters and the first summary filter is labelled **All Printers**. Full `npm test` and an endurance memory run passed before release.

### v0.30.3

- **Community Edition printer allowance:** the default/unlicensed Community allowance is increased from 2 to 3 physical printers. Pro remains 10 and Farm remains 25. Simulator printers remain licence-exempt. Signed customer licences continue to use their independently signed `maxPrinters` value, so existing signed licences are not silently modified.

### v0.30.4

- **Licence storage standardisation:** `DATA_DIR/license.json` is now the canonical signed licence location for source/development, packaged Windows and future container/Linux deployments. A valid legacy application-root `license.json` is verified and automatically migrated into the data directory, with the previous copy removed only after the canonical write succeeds. Invalid/tampered legacy licences remain in place and fail closed rather than being promoted. Licence installation/replacement writes to the data directory, and normal production startup ignores alternate licence-file environment paths.

### v0.31.0

- **K3s validation:** the public GHCR image has been deployed successfully to K3s using PVCs for `/data` and `/logs`. Because the container runs as UID/GID 1000, K3s PVCs require pod-level `fsGroup: 1000` (with explicit `runAsUser: 1000`, `runAsGroup: 1000`, and `runAsNonRoot: true` recommended). `DATA_DIR`, `LOG_DIR`, `HOST`, and `PORT` do not need Kubernetes env overrides because the image already supplies `/data`, `/logs`, `0.0.0.0`, and `4242`. `DISCOVERY_SUBNET` remains optional and deployment-specific. If a storage driver does not honour `fsGroup`, a root init container may `chown -R 1000:1000 /data /logs` before startup.

- **GHCR publishing workflow:** `.github/workflows/container-image.yml` runs `npm test`, performs a Linux container smoke test, then builds multi-architecture `linux/amd64` and `linux/arm64` images with Buildx/QEMU. Pull requests validate without publishing; pushes to `main` publish `ghcr.io/andy-knight/print-farm-controller:latest`; version tags such as `v0.31.0` publish `0.31.0` and `0.31`. Publishing authenticates with the repository `GITHUB_TOKEN` and OCI metadata links the package back to the repository.

- **Container deployment baseline:** Node 24 Linux Docker image with persistent `/data` and `/logs`; Docker Desktop validation passed for controller startup, UI access, persistence, Snapmaker U1 direct connection/camera and FlashForge AD5M Pro direct connection. Docker Desktop LAN scanning requires an explicit physical subnet because the container sees a virtual interface, so optional `DISCOVERY_SUBNET` (bounded `/22`-`/30`) augments native discovery. Snapmaker scans the configured subnet with bounded Moonraker probes; FlashForge sends directed broadcast plus bounded per-host UDP discovery probes and falls back to active TCP `~M115` identity probes on port 8899 when UDP replies are unavailable through Docker Desktop. Native discovery remains unchanged without the environment setting.

### v0.31.1

- **Restore compatibility:** restore inspection no longer enforces the obsolete single-group-per-printer invariant. A printer may appear in multiple restored printer groups, matching the current PrinterGroupService behaviour. Validation still requires each referenced printer to exist and retains duplicate group ID/name, queue-group and maintenance-group integrity checks. Regression coverage now verifies a backup containing one printer in multiple groups inspects successfully.

### v0.32.0

- **Backup compression:** `.pfcbackup` remains a ZIP-compatible logical backup format. The archive writer now streams ZIP DEFLATE (method 8) for compressible JSON/G-code/text payloads and retains ZIP STORE (method 0) for already-compressed formats such as 3MF and common image/archive files. The reader/restorer accepts both methods so existing backups remain compatible; CRC-32 and SHA-256 verification operate on decompressed logical data, and inflate output is rejected if it exceeds the ZIP-declared uncompressed size. Compression uses built-in `node:zlib` with no new runtime dependency. Focused regression coverage was added for DEFLATE, STORE compatibility, corruption handling and decompression-size guarding.

### v0.33.0

- **Google Drive backups:** Backup & recovery supports Google Drive for manual/scheduled backups and direct cloud restore while keeping the canonical compressed/verified `.pfcbackup` and existing restore engine authoritative. Authentication uses Google's limited-input/device OAuth flow with `drive.file`. Production bundles can embed one shared Print Farm Controller OAuth client from build-time `PFC_GOOGLE_CLIENT_ID` / `PFC_GOOGLE_CLIENT_SECRET`; GitHub Actions injects repository secrets into non-PR production container builds via BuildKit secret mounts, while Windows SEA builds consume the same environment variables. Normal customers therefore only select **Connect** and authorize their own Google account. UI-saved custom OAuth configuration and runtime `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` overrides remain available, with precedence custom → environment → built-in. Built-in credentials are not copied into `<DATA_DIR>/integrations/google-drive.json`; that file stores the customer refresh token/folder state plus custom overrides only, and remains excluded from backups/diagnostics. The cloud restore provider registry lists/downloads Google backups into temporary staging, then reuses the existing inspection/staging/restart/rollback path and re-downloads/revalidates at actual staging. The self-contained Google Drive flow has also been validated from a deployed production container using the built-in OAuth configuration injected by GitHub Actions.

### v0.35.0

- **Generic S3-compatible backup and restore:** PR #60 is merged to `main`, adding an S3 provider for manual/scheduled backup and direct cloud restore while retaining the canonical `.pfcbackup` and existing restore engine. The client implements AWS Signature Version 4 with Node built-ins and no runtime AWS SDK dependency. Configuration supports endpoint, bucket, region, prefix, access-key credentials, path-style/virtual-hosted addressing, and an explicit insecure-HTTP opt-in for trusted local development. Each backup is paired with a small PFC metadata sidecar so scheduled retention can identify only scheduled backups owned by the same installation. `<DATA_DIR>/integrations/s3.json` is excluded from backups/diagnostics and the secret key is never exposed through status APIs. Automated coverage includes signing/configuration tests, manager/scheduler/UI coverage and a pinned MinIO integration test for real S3 bucket creation, upload, listing, download and retention.


### v0.36.0

- **Microsoft OneDrive reconciliation:** draft PR #59 is rebuilt on the merged v0.35.0 S3 baseline and advances the OneDrive feature from its original v0.34.0 development version to v0.36.0. OneDrive uses Microsoft device-code OAuth with `offline_access Files.ReadWrite.AppFolder`, Graph `approot`, large-file upload sessions, safe PFC metadata sidecars, manual/scheduled backup, controller-scoped retention and cloud restore through the existing provider registry. The reconciliation preserves Google Drive and S3 in the same scheduler/UI/server baseline, adds production bundle/container support for `PFC_MICROSOFT_CLIENT_ID`, and keeps OneDrive authorization state excluded from backups and diagnostics. Real Microsoft account validation remains pending; automated regression and packaging validation cover the implementation until live credentials are available.
