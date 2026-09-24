# Print Farm Controller — Project Context

> Cross-chat handoff file. Read this first when continuing the project in a new chat. Keep it concise and update it whenever architecture/decisions change, a task is completed, or the current/next task changes.

## Source of truth

- Repository: `Andy-Knight/Print-Farm-Controller`
- Project path: repository root (`/`)
- Primary branch: `main` (current production baseline)
- Current application version on this branch: **0.24.0**.
- v0.15.5 Print Library previews are merged into `main`.
- v0.15.6 includes dashboard summary filtering, application-local data storage, Snapmaker U1 display naming and printer-card hover/focus highlighting.
- **v0.16.0 production packaging is merged into `main`** via PR #24 (squash commit `af8d8e493e2f311c1469ed5faddfffc2316ae727`): centralized runtime paths detect source vs Node SEA execution, esbuild produces a CommonJS controller bundle, and the Windows x64 SEA build embeds the controller UI, simulator UI/resources and trusted Ed25519 public verification keys directly into `PrintFarmController.exe`. The Windows installer targets Program Files, leaves the EXE protected, grants standard-user modify permission only to `data/`, and packaged builds store the signed customer licence at `data/license.json`. Inno Setup 7 is the preferred Windows installer compiler (Inno Setup 6 remains supported as a fallback), and optional Authenticode signing workflows are included.
- **v0.16.1 dashboard/UI polish is merged into `main`** via PR #25 (squash commit `8936dcf40a75579d6575306d95e3eca79f4508f5`): main-dashboard **Idle** and **Ready** status badges are green in both Dark and Light modes, matching the Printer Simulator's available-state treatment. Print Library thumbnail and enlarged-preview backgrounds use the existing Light-mode colour `#f3f7fa` in both themes. Existing Offline/Error/Pause styling is unchanged.
- **v0.18.0 concurrent client safety is merged into `main`** via PR #27. The controller coordinates conflicting operations per printer and tracks longer physical workflows such as bed levelling and U1 tool calibration; U1 bed levelling also exposes Homing / Heating / Stabilising / Probing phases and printer-detail errors are surfaced at the top of the printer window.
- **v0.19.0 printer activity status messaging is merged into `main`** via PR #28. It generalises the prominent printer-window activity banner beyond the U1 so controller-tracked bed levelling/calibration and chamber preheat are surfaced consistently across supported printer types.
- **v0.20.0 diagnostic logging is merged into `main`** via PR #29. It adds controller-wide structured diagnostic logging, an independent application-local `logs/` runtime path with `LOG_DIR` override, log rotation/redaction, menu-based recent-log viewing, temporary verbose DEBUG mode, and sanitized ZIP diagnostic bundles. Windows packaging grants standard users write access to both `data/` and `logs/`.
- v0.20.0 also fixes U1 bed-levelling activity persistence: while the blocking Moonraker levelling request is running, the controller keeps the activity sticky so transient idle-looking polls cannot erase the Homing / Heating / Stabilising / Probing banner. Closing and reopening the printer-detail dialog therefore reconstructs the active levelling status correctly.
- **v0.20.1 printer-detail opening reliability is merged into `main`** via PR #30. The printer-detail dialog opens immediately with a loading state before file enumeration completes, stale asynchronous open requests are discarded after close/reopen, and open failures are no longer silent. Dashboard connection errors are rendered below the **Open printer** button so the action buttons remain aligned across printer cards.
- **v0.20.2 dashboard click reliability is merged into `main`** via PR #31. Live fleet reconciliation updates existing cards in place and only moves a card when its actual fleet order differs from the DOM, preventing a live status event from detaching an **Open printer** button between pointer-down and click.
- **v0.21.0 Print Library printer targeting is in the current `main` baseline.** Print Library files can optionally store a canonical target printer adapter/model. The add/edit/queue-upload UI exposes the supported model list; library cards/search and queued jobs show the target; queue compatibility treats a target mismatch as incompatible; and files without a target remain unrestricted.
- **v0.22.0 colour-family matching is merged into the current `main` baseline** via PR #33.
- **v0.23.0 Backup & Recovery is merged into the current `main` baseline via PR #34.** The backup/recovery architecture is defined in `docs/BACKUP_RECOVERY.md`. The target is a portable logical `.pfcbackup` format with manifest/checksums, manual and scheduled local/NAS backup, validated two-phase restore activated on restart with rollback, and explicit recovery holds so unfinished restored queue work can never auto-start. Cloud destinations and built-in encryption are deferred. Queue colour compatibility treats slicer hex values as shade metadata within practical colour families rather than requiring byte-for-byte hex equality. Same-family shades can run automatically; different families remain blocked. FlashForge manual filament designation stores an authoritative colour family only; existing hex-only designations automatically derive their family, and saving a new manual designation clears the legacy shade. FlashForge, editable/non-RFID Snapmaker U1, and simulated Bambu AMS/AMS Lite/external-spool selectors use the same custom family dropdown, with a consistent square swatch rendered inside each option and selected value. Pending U1 filament type/colour edits are protected from live telemetry until the Set filament operation succeeds. The U1 and simulator write representative hex colours internally; official U1 RFID filament and real Bambu tray colours remain printer-reported. U1/AMS candidate mapping prefers the closest compatible shade using CIELAB colour distance without turning shade distance itself into a hard requirement.
- **Current v0.24.0 feature branch:** `feature/maintenance-tracking-v0240`. Maintenance tracking is controller-owned and manufacturer-agnostic. It persists recurring tasks, completion history, and controller-observed print time/cycles in `data/maintenance.json`; tasks can be scheduled by calendar days, observed print hours, or observed print cycles and expose Current / Due soon / Due state. Maintenance data is included in logical `.pfcbackup` backup/restore.
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
        +-- persistent print queue + history + bed-clearance interlock
        +-- persistent maintenance tasks + completion history + controller-observed printer usage
        +-- logical `.pfcbackup` backup/recovery + scheduled local/network backups + staged restart restore/rollback
        +-- signed licence loader / verifier / edition + printer-slot enforcement
        |
        v
PrinterAdapter boundary (`src/adapters/`)
        +-- FlashForge Adventurer 5M / 5M Pro
        +-- Snapmaker U1 -> Moonraker / Klipper
        +-- Bambu Lab P1P / P1S / X1C / A1 Mini -> experimental MQTT/FTPS adapter; P1/A1 Mini TLS-JPEG camera

Development Printer Emulator (`emulator/`, loopback only)
        +-- management UI/API + SSE
        +-- shared virtual-printer state and scenarios
        +-- FlashForge HTTP/TCP/camera endpoints
        +-- Snapmaker U1 Moonraker endpoints
        +-- Bambu P1P/P1S/X1C/A1 Mini MQTT TLS, FTPS TLS and camera test endpoints
```

Manufacturer-specific discovery, capabilities, limits, status normalization, files, print control, temperatures and camera selection belong behind the adapter boundary. Core fleet services should remain manufacturer-agnostic.

## Important decisions

- Local-first/LAN-only controller; printer credentials remain backend-side.
- Multiple manufacturers are supported through adapters rather than manufacturer logic in shared fleet code.
- Default persistent controller data now lives in the application-local `data/` directory rather than the operating-system user profile. If `data/` does not yet exist, startup migrates the previous profile-based `Printer Fleet Controller` directory, falling back to the older `FlashForge Fleet` location. This moves printer configuration, queue/history, Print Library files, emulator settings and file material metadata together. Custom `DATA_DIR` locations are used exactly as configured and are never moved.
- Print Library files, queue/history and their references persist across restarts. Queue/history cleanup never owns library-file deletion.
- Maintenance tracking is a controller-owned fleet service keyed by printer ID rather than adapter-specific state. `maintenance.json` stores task definitions, completion history, per-task interval baselines, and controller-observed print seconds/cycles. Observed counters begin when this controller tracks activity and must not be presented as manufacturer lifetime counters. A maintenance task may recur by calendar days, observed print hours, or observed print count; reaching 80% of an interval is **Due soon**, reaching 100% is **Due**. Completing a task creates a retained history entry with notes/usage snapshot before resetting only that task's baseline.
- Backup/recovery uses portable logical `.pfcbackup` archives rather than raw `data/` copies. Archives carry a manifest and checksums, include controller configuration/state and Print Library content, and exclude logs, executables/build artifacts, transient files and private licensing keys.
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
- The browser appearance switch is accessible, persists only in browser `localStorage`, and follows the device colour scheme until the user explicitly selects Light or Dark.
- **Live-telemetry edit protection rule:** if a UI field is both refreshed from live printer telemetry and user-editable, and the user's change requires a separate **Save / Apply / Set** action, the UI must treat the edit as pending/dirty and must not let telemetry overwrite the user's unsaved value. Clear the dirty state only after the write succeeds (or the control is intentionally rebuilt/cancelled). The Snapmaker U1 filament type/colour editor is the current reference implementation. Controls that save immediately on selection, or controls that are not rewritten by telemetry, do not need this protection.
- Queue priority is **High / Normal / Low**. Effective priority ranks before manual queue order; a waiting job gains one priority level every six hours so low-priority work cannot be starved. Within the same effective priority, manual order remains authoritative.
- When multiple compatible idle printers are ready for an automatic job, a printer with a verified existing copy of the file is preferred; the assigned job records the selection reason.
- The development printer simulator is integrated into the controller lifecycle and UI, but its virtual protocol endpoints remain loopback-only. It is disabled by default, remembers explicit enablement, and exercises production adapters through network protocols rather than bypassing the adapter boundary. Simulator-only support never counts as physical hardware validation. The standalone emulator command remains available for development.
- Bambu P1P/P1S/X1C/A1 Mini support remains explicitly experimental until MQTT telemetry/commands, FTPS behavior, material mapping and camera behavior are compared with physical printers. P1P/P1S/A1 Mini use the TLS/JPEG camera path on port 6000. X1C uses RTSPS/H.264 on port 322; the controller deliberately reports X1C camera as unsupported until a suitable decoder is implemented. Manual entry is used; Bambu LAN discovery is not yet implemented.
- Bambu AMS support models each AMS/AMS Lite tray and the external spool as a material source, separate from the printer's single physical nozzle. Automatic scheduling maps logical 3MF filaments to unique live sources, while multi-material raw G-code is rejected because it does not carry the project-level mapping required by the print command.
- Production licensing is offline and Ed25519-signed. The controller ships trusted public verification keys only; production private keys live only in the separate private `Andy-Knight/Print-Farm-Licensing` application.
- No valid signed licence means Community Edition. Current physical-printer allowances are Community 2, Pro 10, Farm 25; simulator printers do not consume licence slots.
- Reducing the allowance never deletes configured printers. Over-limit fleets retain all printers and require selection of the physical printers that occupy active licence slots.
- Source/development mode keeps the signed licence at `<application directory>/license.json`. Packaged SEA builds prefer `<application directory>/data/license.json` so Program Files can remain read-only; an older application-directory `license.json` is still accepted for migration.
- Production startup must not allow environment-variable licence bypasses. `PRINT_CONTROLLER_EDITION` and arbitrary public-key trust are ignored unless source/test code explicitly enables the internal development override path.
- Licence installation/replacement reloads the signed licence immediately; a normal controller restart is not required.
- The edition entitlement catalogue exists for future feature-by-feature enforcement. As of v0.14.8 the production enforcement path includes signature/expiry validation and physical-printer slot limits; do not describe every entitlement as fully gated unless the code has actually been wired to enforce it.

## Completed work / current baseline

- FlashForge Adventurer 5M / 5M Pro support.
- Snapmaker U1 support via Moonraker/Klipper, including stock camera integration.
- Experimental Bambu Lab P1P/P1S/X1C/A1 Mini controller support: MQTT TLS status, external-spool/AMS/AMS Lite material metadata and job/temperature/fan control; implicit FTPS list/upload/verification/download; embedded 3MF plate-G-code requirement parsing; interactive and automatic logical-filament-to-material-source mapping; `.3mf` print start on all supported Bambu models plus single-material `.gcode` start on P1P/P1S/X1C/A1 Mini; authenticated TLS/JPEG camera snapshots on P1P/P1S/A1 Mini; model-specific capabilities/limits and manual connection fields. A1 Mini uses an 80 °C bed limit and no chamber controls. X1C reports LiDAR availability, a hardened nozzle profile and a 120 °C bed limit, while its RTSPS/H.264 camera remains explicitly unsupported. FTPS upload verification checks the exact filename with `SIZE`, falls back to normalized directory entries and retries briefly for delayed storage visibility.
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
- **v0.11.3 staged-file cleanup:** clearing print history immediately removes controller-staged queue files that have no remaining queue/history reference; shared/referenced files are retained. Historical only; v0.15.0 supersedes this lifecycle with explicit persistent Print Library deletion.
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
- **v0.14.9 product branding:** application renamed from **Printer Fleet Controller** to **Print Farm Controller** across the browser UI, runtime messages, simulator wording and documentation. Historical application-data directory names, npm package/service identifiers and the existing browser theme storage key are intentionally retained to preserve upgrades, integrations and saved preferences.
- **v0.14.10 button hover feedback:** all enabled buttons gain a hover/focus colour change. Dark mode brightens buttons and light mode slightly darkens them; disabled buttons are unaffected.
- **v0.14.11 FlashForge emulator material fidelity:** simulated FlashForge `/detail` no longer reports `rightFilamentType` by default. The virtual printer still keeps its internal filament material for simulator state/scenarios, but the production adapter correctly sees no printer-reported material unless the physical protocol actually supplies one. This aligns the designation control with physical AD5M-family behaviour: **Clear designation** when there is no reported material, **Use printer value** only when a value is genuinely reported.
- **v0.14.12 Snapmaker U1 display naming:** dashboard cards and printer-details diagnostics render the Snapmaker model as **Snapmaker U1** instead of the raw stored model `U1`. Stored configuration and adapter identity remain unchanged.
- **v0.15.0 persistent Print Library:** controller-owned print files are promoted from queue-owned staging into a searchable persistent library. Users can add files without queueing them, inspect detected material/nozzle/tool requirements, queue a selected library entry with quantity and priority, and explicitly delete unreferenced files. SHA-256/size deduplication prevents duplicate storage. Existing `queue-files/` entries migrate to `print-library/` without changing IDs. Legacy queue-file module/API contracts remain compatibility aliases, but queue/history cleanup no longer prunes files.
- **v0.15.1 Print Library colour listing:** when print requirements contain filament colours, library cards list each distinct detected colour with a swatch plus hexadecimal and RGB values.
- **v0.15.2 responsive top bar:** Light/Dark remains permanently visible. Printer simulator and Licence live in a compact overflow menu; Fleet operations stays visible on wider layouts and moves into the same overflow at narrower desktop widths. The header switches to a stacked responsive layout before controls become cramped.
- **v0.15.3 light-mode offline warning:** Offline and Error printer badges retain the same red warning treatment in Light mode instead of being overridden by the generic light badge colours.
- **v0.15.4 Print Library descriptions:** library files support optional free-text description/notes (maximum 4000 characters). Notes are persisted in library metadata, displayed on cards, included in search, editable later through **Edit details**, and accepted when a new file is uploaded through either the library or queue workflow.
- **v0.15.5 Print Library previews:** library files cache slicer-provided preview images when available. 3MF extraction prefers Orca/Bambu plate thumbnails such as `Metadata/plate_1.png`; G-code extraction recognises embedded PNG/JPEG thumbnail blocks and selects the largest supported image. Existing entries are backfilled on first read. The library card shows a compact thumbnail or **No preview** placeholder, and clicking a real thumbnail opens a larger viewer.
- **v0.15.6 dashboard filtering:** the top summary cards are interactive filters for all printers, online printers, actively printing printers, and printers needing attention. The active filter is highlighted, live state changes automatically re-evaluate visibility, and printer reordering controls are hidden while a subset is filtered. This build also includes the application-local `data/` storage change, Snapmaker U1 display naming and printer-card hover/focus highlighting.
- **v0.16.0 production packaging:** hardened Windows x64 Node SEA executable with embedded controller/simulator assets and trusted public licence keys; Inno Setup 7 installer targeting Program Files; normal-user writable `data/`; packaged `data/license.json`; optional Authenticode release-signing workflow; Node 24 production baseline.
- **v0.17.0 experimental A1 Mini support:** `feature/bambu-a1-mini` extends the Bambu LAN adapter and integrated emulator to A1 Mini, including MQTT status/control, FTPS file operations, TLS/JPEG camera support, AMS Lite material mapping, 80 °C bed limit, 300 °C nozzle limit, no chamber controls, `.3mf` printing, and experimental single-material `.gcode` starts via `gcode_file`; multi-material AMS Lite jobs remain `.3mf`-only and physical A1 Mini validation is still required. Physical A1 Mini validation remains outstanding.

## Current task

**v0.24.0 Maintenance Tracking** is the active feature on `feature/maintenance-tracking-v0240`.

The first implementation is manufacturer-agnostic and controller-owned. A persistent `data/maintenance.json` store tracks recurring maintenance tasks, completion history, controller-observed print seconds and observed print cycles per configured printer. Tasks support calendar-day, print-hour, or print-count intervals and expose Current, Due soon and Due state. Completion records optional notes and a usage snapshot while retaining history even if the task is later deleted.

The Maintenance UI is available from the controller overflow menu and supports adding, editing, enabling/disabling, completing and deleting tasks across the fleet. It shows observed usage and recent history per printer. Usage is explicitly labelled controller-observed because it is derived from live printer activity seen by this controller rather than a manufacturer lifetime counter.

Maintenance state participates in v0.23+ logical backup/recovery. New backups include `state/maintenance.json`; restore validates and stages it, while older backups without maintenance state restore an empty maintenance store rather than retaining unrelated target-machine maintenance data.

Current implementation includes service-layer tests for persistence, day/hour/count scheduling and usage tracking; UI/API wiring tests; backup coverage; and disaster-recovery preservation coverage. Automated Windows/Node 24 validation completed on 24 September 2026 with **325 passing tests, 0 failures**, followed by a successful `npm run build:bundle` production-controller bundle build.

## Next steps

1. Live-test the Maintenance dialog in Dark and Light modes on desktop and mobile widths.
2. Validate observed print-hour/cycle accounting with a real Snapmaker U1 and FlashForge AD5M Pro print, including pause/resume and controller restart behavior.
3. Decide whether to add optional model-specific starter task templates after the generic workflow is validated.
4. Continue physical validation of experimental Bambu behaviour before removing the experimental designation.
5. Add Linux x64 and ARM64 packaging after the active maintenance work.

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
- source/development mode: `<application directory>/license.json`
- packaged SEA builds: `<application directory>/data/license.json`

Packaged licence-file lookup order:
1. `PRINT_CONTROLLER_LICENSE_FILE` explicit file override, when deliberately configured.
2. Preferred packaged `data/license.json`.
3. Previous application-directory `license.json` for migration compatibility.
4. Other legacy data-directory location where applicable.
5. No file -> Community Edition.

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

