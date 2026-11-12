# Print Farm Controller — Project Context
Cross-chat handoff file. At the start of every new development conversation, read root `AGENTS.md` and `docs/DOCUMENTATION_POLICY.md` as well as this file. Use **Current work** for open work and validation gaps. Record lasting constraints under **Important decisions** and release changes in `CHANGELOG.md`.

## Handoff rule

If chat context and this file disagree about the codebase, inspect current GitHub files and tests. **GitHub is authoritative for code; this document is authoritative for project intent/status until deliberately updated.**

Repository policy: `AGENTS.md` defines agent startup behavior; `docs/DOCUMENTATION_POLICY.md` assigns documentation ownership; `docs/CONTROLLER_VISUAL_STYLE_GUIDE.md` is the canonical visual specification. New conversations must load these files from the active branch, not rely solely on conversational memory.

## Source of truth
- Repository: `Andy-Knight/Print-Farm-Controller`
- Project path: repository root (`/`)
- Primary branch: `main` (current production baseline)
- Current controller source version: **0.67.0**.
- Runtime: **Node.js 24.22.1+** (Node 24 release line), ES modules; build-time **npm 12.2.0** and committed lockfile; no npm runtime dependency for deployed controller. Follow `docs/dependency-security.md` for updates.
- GitHub is the authoritative code baseline.
- `CHANGELOG.md` owns all per-version release history. `README.md` describes the current product; this file contains active project context, not a release diary. See `docs/DOCUMENTATION_POLICY.md`.

## Current work

- **Physical printer acceptance.** Validate Creator 5/Pro and the experimental Bambu adapters against real hardware. For X1C, verify RTSPS live view and decoder cleanup on Windows and Kubernetes AMD64/ARM64. For A1, verify AMS Lite and external-spool workflows. See [X1C acceptance](docs/X1C_CAMERA.md#validation) and [A1 acceptance](docs/BAMBU_A1.md#simulator-and-acceptance).
- **External HTTPS certificate acceptance.** Verify external PEM import and replacement over a trusted HTTPS connection on deployed Windows and Kubernetes installations. See [HTTPS release validation](docs/HTTPS_CONFIGURATION.md#release-validation).
- **Windows deployment acceptance.** Validate installer ownership and upgrades using a separate selected account under UAC. Verify the signed Windows path for a signed distribution. See [Windows storage security](docs/WINDOWS_DATA_SECURITY.md) and [Windows releases](docs/WINDOWS_RELEASES.md).

## Architecture

```text
Controller browser UI (public/, Preact built from ui/ plus DOM fallback)
    | HTTP(S) API and fleet SSE, with session and role checks
    v
Node.js controller (src/server.js) <--- Standalone map display (public/map-display.html)
    |                                    GET /api/map-display with one room's bearer link
    +-- HTTP(S), account/session security, RBAC, resource admission and diagnostics
    +-- Printer registry, discovery, fleet state, cameras and alerts
    +-- Printer groups and shared room maps with administrator-only editing
    +-- Print Library, compatibility, file distribution, queue/history and bed clearance
    +-- Batch control, chamber preheat, maintenance, reporting and filament costing
    +-- Portable backups, scheduled destinations and restart restore/rollback
    +-- Offline signed licensing and physical-printer slot enforcement
    +-- Persistent state and library files in DATA_DIR, diagnostics in LOG_DIR
    |
    v
Printer adapters (src/adapters/)
    +-- FlashForge Adventurer 5M / 5M Pro: HTTP, TCP 8899 and MJPEG
    +-- FlashForge Creator 5 / Pro: modern HTTP API, four tools and MJPEG
    +-- Snapmaker U1: Moonraker / Klipper
    +-- Prusa CORE One+: PrusaLink HTTP with Digest or API key
    +-- Bambu P1P / P1S / X1C / A1 / A1 Mini: MQTT over TLS and FTPS
        +-- P1/A1-series TLS/JPEG cameras, X1C RTSPS/H.264 via bundled FFmpeg
    |
    +-- Physical printers on the LAN
    +-- Virtual printer protocol endpoints (emulator/; loopback when integrated)
        +-- Controller-managed scenarios or standalone development UI/API and SSE
```

Manufacturer-specific discovery, capabilities, limits, status normalization, files, print control, temperatures and camera selection belong behind the adapter boundary. Core fleet services should remain manufacturer-agnostic.

## Important decisions

- Diagnostics records printer-operation starts/results at INFO and failures at WARN. There is no temporary verbose mode; preserve administrator-only viewing, redaction, file rotation and support bundles.
- Authentication event diagnostics use allowlisted metadata and the socket peer address. The logger caps outstanding event writes at 32 and summarizes overflow. A logging failure leaves authentication decisions intact.
- Local-first/LAN-only controller; printer credentials remain backend-side.
- The integrated simulator is a controller route with the shared sidebar and top bar. Its embedded controls use their own same-origin session bootstrap and refresh CSRF before each mutation. Preserve administrator and Origin checks and the standalone loopback simulator.
- Multiple manufacturers are supported through adapters rather than manufacturer logic in shared fleet code.
- Creator 5-series support uses a separate `flashforge-creator5` adapter rather than extending the AD5M adapter. Creator 5/Pro share the modern authenticated FlashForge HTTP API but do not expose the legacy TCP 8899 file/control service and have four physical toolheads/material slots, so inheriting AD5M single-tool/TCP assumptions would be unsafe. Creator 5 discovery PIDs are 40 (Creator 5) and 41 (Creator 5 Pro); discovery may still advertise 8899, but the adapter deliberately ignores it.
- Creator 5 printer-local file browsing is recent-only through `/gcodeList`; full storage enumeration and per-file sliced tool requirements are not exposed by the local API. Automatic queue jobs originating from the controller Print Library carry their parsed logical-tool/material/nozzle metadata into compatibility, upload and print-start mapping. For an already-stored printer-local file, the controller warns that it must use the mapping/defaults saved with the file rather than inventing requirements.
- Creator 5 Pro native chamber temperature control is distinct from the controller's generic bed-powered chamber-preheat feature. The Pro exposes a chamber sensor and direct target up to 65 °C; base Creator 5 does not. Creator 5 Pro filtration hardware is not exposed as a writable controller capability because the available local circulation command is ineffective.
- Default persistent controller data now lives in the application-local `data/` directory rather than the operating-system user profile. If `data/` does not yet exist, startup migrates the previous profile-based `Printer Fleet Controller` directory, falling back to the older `FlashForge Fleet` location. This moves printer configuration, queue/history, Print Library files, emulator settings and file material metadata together. Custom `DATA_DIR` locations are used exactly as configured and are never moved.
- Print Library files, queue/history and their references persist across restarts. Queue/history cleanup never owns library-file deletion.
- Print Library attribution preserves the original uploader and tracks a separate transferable quota owner. Transfers require an enabled account with capacity. Storage history records actual hourly observations in the backed-up `library-storage-history.json` store and preserves gaps. See [library ownership and quotas](docs/RESOURCE_AND_BACKUP_LIMITS.md).
- Printer groups are controller-owned and manufacturer-agnostic. A printer may belong to zero, one or multiple groups at the same time; editing one group changes only that group's membership. Group membership is not part of printer connection/adaptor configuration.
- Printer maps are shared layouts stored in `printer-maps.json` in the controller data directory and included in portable backups. Admin writes check map revisions and serialize with printer registry mutations. A printer can be placed in one room at a time. Tile status comes from the live fleet, queue and alerts rather than the saved layout. Admins can opt a map into standalone monitoring using a revocable bearer link. The link is persisted with the map, excluded from normal map responses and portable backups, and accepted only by the dedicated read-only display endpoint.
  A printer placement is either a free position on the plan or a reference to a rack, level and bay on the same map. Rack moves change the rack footprint and preserve the slot assignments.
  A monitoring link can read bounded alert summaries for printers placed on its map. Verify membership on each request and return fixed event labels, severity, time and read status. Keep diagnostic messages, alert metadata and alert mutations behind controller authentication.
- Automatic queue work may optionally carry a printer-group restriction. The controller evaluates only current members of that group for assignment, and group membership changes trigger queue reevaluation. The group restriction narrows the candidate set but does not bypass model/file targeting, material/colour/nozzle compatibility, licensing, busy state, bed clearance, concurrency or any other safety/preflight rule.
- Maintenance task assignment supports three scopes: individual printer, custom printer group, and printer model. Group-wide rules follow current group membership while maintaining independent per-printer assignment state, recurrence baseline, last-completed data and history.
- Maintenance tracking is a controller-owned fleet service keyed by printer ID rather than adapter-specific state. `maintenance.json` stores task definitions, completion history, per-task interval baselines, and controller-observed print seconds/cycles. Observed counters begin when this controller tracks activity and must not be presented as manufacturer lifetime counters. A maintenance task may recur by calendar days, observed print hours, or observed print count; reaching 80% of an interval is **Due soon**, reaching 100% is **Due**. Completing a task creates a retained history entry with notes/usage snapshot before resetting only that task's baseline.
- Backup/recovery uses portable logical `.pfcbackup` archives rather than raw `data/` copies. Archives carry a manifest and checksums, include controller configuration/state, printer-group definitions/membership, Print Library content, the filament catalogue and persistent reporting history, and exclude logs, executables/build artifacts, transient files and private licensing keys. Older backups without newer stores such as `printer-groups.json`, `filaments.json` or `reporting-history.json` restore with compatible empty defaults.
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
- Explicit administrator library deletion removes the stored file and all linked terminal queue/reporting records by library ID, after confirming that report totals will change. Active/pending work, active production siblings and uncleared beds still block deletion. Queue persistence and terminal reporting share one save chain so stale callbacks cannot recreate purged records; cleanup persists history before removing the file and failed cleanup can be retried.
- Every application release updates `package.json`, the lockfile, the current-version metadata in `README.md` and `PROJECT_CONTEXT.md`, and a new version entry in `CHANGELOG.md`. Documentation-only changes do not require an application version bump.
- **Native authentication and RBAC.** Authorization is enforced server-side independently from signed licences. Authentication defaults on. The first administrator uses a one-time startup-log code. The activation marker preserves the authentication requirement after account data loss. Mutations require Origin and CSRF checks. Account deletion protects the current account and last enabled administrator and revokes the deleted user's sessions and streams. See [Authentication and RBAC](docs/AUTHENTICATION_AND_RBAC.md).
- **Native HTTPS.** The controller protects certificate keys, requires HTTPS for external PEM import, and restricts the HTTP listener to limited health responses and browser redirects when TLS is active. See [HTTPS configuration](docs/HTTPS_CONFIGURATION.md).
- **Resource and storage boundaries.** Preserve aggregate admission, bounded file inspection and backup verification, operation-wide cloud deadlines, and cleanup before backup-lock release. Resource policy changes apply after restart. Environment overrides and target installation policy remain authoritative. Keep separate data/log paths and preserve Windows storage ownership across upgrades. See [Resource and backup limits](docs/RESOURCE_AND_BACKUP_LIMITS.md) and [Windows storage security](docs/WINDOWS_DATA_SECURITY.md).
- **Windows packaging.** Main-only CI creates an unpublished Windows draft after regression, Windows packaging and production container validation. Assets must match the source commit and checksum. Preserve existing releases and tags and keep production build configuration out of PR jobs. See [Windows releases](docs/WINDOWS_RELEASES.md).
- **Documentation authority:** `README.md` contains current capabilities and setup (current-version metadata only), `CHANGELOG.md` contains every release change, this file contains live handoff/decisions, and `docs/CONTROLLER_VISUAL_STYLE_GUIDE.md` contains visual standards. Follow `AGENTS.md` and `docs/DOCUMENTATION_POLICY.md`.
- The browser appearance switch is accessible, persists only in browser `localStorage`, and follows the device colour scheme until the user explicitly selects Light or Dark.
- **Live-telemetry edit protection rule:** if a UI field is both refreshed from live printer telemetry and user-editable, and the user's change requires a separate **Save / Apply / Set** action, the UI must treat the edit as pending/dirty and must not let telemetry overwrite the user's unsaved value. Clear the dirty state only after the write succeeds (or the control is intentionally rebuilt/cancelled). The Snapmaker U1 filament type/colour editor is the current reference implementation. Controls that save immediately on selection, or controls that are not rewritten by telemetry, do not need this protection.
- Queue priority is **High / Normal / Low**. Effective priority ranks before manual queue order; a waiting job gains one priority level every six hours so low-priority work cannot be starved. Within the same effective priority, manual order remains authoritative.
- When multiple compatible idle printers are ready for an automatic job, a printer with a verified existing copy of the file is preferred; the assigned job records the selection reason.
- The development printer simulator is integrated into the controller lifecycle and UI, but its virtual protocol endpoints remain loopback-only. It is disabled by default, remembers explicit enablement, and exercises production adapters through network protocols rather than bypassing the adapter boundary. Simulator-only support never counts as physical hardware validation. The standalone emulator command remains available for development.
- Bambu P1P/P1S/X1C/A1/A1 Mini support remains explicitly experimental until MQTT telemetry/commands, FTPS behavior, material mapping and camera behavior are compared with physical printers. P1P/P1S/A1/A1 Mini use the TLS/JPEG camera path on port 6000. X1C uses RTSPS/H.264 on port 322; experimental JPEG/MJPEG conversion uses the automatically discovered source-built LGPL FFmpeg decoder bundled in Windows/container packages; `PFC_FFMPEG_PATH` remains an optional administrator override. Matching source, notices and build records accompany the binary; see `docs/X1C_CAMERA.md`. Manual entry is used; Bambu LAN discovery is not yet implemented.
- Bambu AMS support models each AMS/AMS Lite tray and the external spool as a material source, separate from the printer's single physical nozzle. Automatic scheduling maps logical 3MF filaments to unique live sources, while multi-material raw G-code is rejected because it does not carry the project-level mapping required by the print command.
- Production licensing is offline and Ed25519-signed. The controller ships trusted public verification keys only; production private keys live only in the separate private `Andy-Knight/Print-Farm-Licensing` application.
- No valid signed licence means Community Edition. Current physical-printer allowances are Community 3, Pro 10, Farm 25; simulator printers do not consume licence slots.
- Reducing the allowance never deletes configured printers. Over-limit fleets retain all printers and require selection of the physical printers that occupy active licence slots.
- Source/development and packaged SEA modes both keep the signed licence at `<DATA_DIR>/license.json` (default `<application directory>/data/license.json`). A valid older application-root `license.json` is verified and automatically migrated into the data directory; invalid/tampered legacy files are not promoted.
- Production startup must not allow environment-variable licence bypasses. `PRINT_CONTROLLER_EDITION` and arbitrary public-key trust are ignored unless source/test code explicitly enables the internal development override path.
- Licence installation/replacement reloads the signed licence immediately; a normal controller restart is not required.
- The edition entitlement catalogue exists for future feature-by-feature enforcement. The production enforcement path includes signature/expiry validation and physical-printer slot limits; do not describe every entitlement as fully gated unless the code has actually been wired to enforce it.

## Current baseline

- Supported printers: FlashForge Adventurer 5M / 5M Pro, FlashForge Creator 5 / Creator 5 Pro, Snapmaker U1, experimental Prusa CORE One+, and experimental Bambu Lab P1P / P1S / X1C / A1 / A1 Mini support.
- Persistent printer registry with manufacturer-specific adapters, local discovery where supported, controller-side printer naming, live SSE fleet state, dashboard filtering and printer groups with overlapping membership.
- Persistent Print Library with descriptions, previews, target-printer metadata, material/colour/nozzle requirements, verified file distribution and queue integration.
- Persistent print queue/history with fixed-printer or next-compatible-printer assignment, priorities, production batches, reprint, compatibility/preflight checks, material/tool mapping and bed-clearance interlocks.
- Persistent reporting/analytics history with graphical trends, printer reliability indicators, popular-file reporting, filament usage/spend, and controller-owned filament catalogue costing with slicer-profile auto-matching.
- Maintenance tracking supports printer-, group- and model-scoped recurring tasks, due-soon/due status, per-printer history and controller-observed print usage.
- Backup & recovery on the production baseline uses portable verified/compressed `.pfcbackup` archives with local/NAS, Google Drive, generic S3-compatible and **Experimental Microsoft OneDrive** destinations, scheduled backups, explicit inspection, staged restart restore, rollback and recovery holds for unfinished queue work. Portable backups include the filament catalogue and persistent reporting history.
- Google Drive production deployments use the shared built-in OAuth configuration injected at build time; customers authorize their own Google account without supplying an OAuth client. Advanced custom OAuth remains available for source/development or bespoke deployments.
- Offline Ed25519-signed licensing enforces physical-printer allowances: Community 3, Pro 10 and Farm 25; simulator printers do not consume licence slots.
- The integrated printer simulator covers FlashForge, Snapmaker, Prusa and Bambu protocol paths for repeatable development and automated validation.
- Production deployment supports the hardened Windows x64 Node SEA/installer path and the multi-architecture GHCR container image for `linux/amd64` and `linux/arm64`, with persistent `/data` and `/logs`.
- Local Windows validation uses isolated simulator ports when another controller is running. Native Schannel decoder tests require an environment with working Windows credential acquisition. See [X1C validation](docs/X1C_CAMERA.md#validation).

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

Do **not** assume every entitlement catalogue entry is systematically enforced throughout the UI/API. The release-gated enforcement is signed-licence validity/expiry plus physical-printer slot limits. Extend feature gating deliberately and test each gated surface.

### Production hardening rule

Normal controller startup must not permit an environment-variable licensing bypass.

Current production policy:

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
