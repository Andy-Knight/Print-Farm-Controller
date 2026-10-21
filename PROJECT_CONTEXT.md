# Print Farm Controller — Project Context
Cross-chat handoff file. Read this first when continuing the project in a new chat. Keep it concise and update it whenever architecture/decisions change, a task is completed, or the current/next task changes.
 
## Handoff rule

If chat context and this file disagree about the codebase, inspect current GitHub files and tests. **GitHub is authoritative for code; this document is authoritative for project intent/status until deliberately updated.**

## Source of truth
- Repository: `Andy-Knight/Print-Farm-Controller`
- Project path: repository root (`/`)
- Primary branch: `main` (current production baseline)
- Current controller source version: **0.59.2** (Print Library compact table layout; in feature branch pending visual acceptance).
- Previous baseline audited: **0.48.0** (main before the regression test audit release).
- Runtime: **Node.js 24+** (development baseline Node.js 24.21.0), ES modules, no npm runtime dependencies.
- GitHub is the authoritative code baseline.
- Release/version history is maintained only in `CHANGELOG.md`; do not duplicate per-version history in this handoff file.

## Current work

**v0.59.2 Print Library table compaction:** Branch `feature/library-compact-table-v0592` caps the routed Library at 1300px (100% of available main workspace), tightens the nine-column grid with smaller Min. sell price and History tracks, uses 10px grid gutters, and switches to card layout below 1351px viewport width to avoid clipped columns. Shared grid variable stays identical for headers/rows; sorting, pricing, scrolling, queue safety and data untouched. Node + Chromium desktop/mobile alignment/overflow tests added. Keep branch until user validates.

**v0.59.1 Farm Management navigation heading:** The six main-sidebar FARM MANAGEMENT routes (/maintenance, /groups, /reports, /alerts, /backup and /diagnostics) now show **Farm management** as the topbar title. Route-specific subtitles, blue page headings, individual page names and sidebar/keyboard/deep-link navigation are preserved. Workspace (Dashboard, Queue & history, Print library) and the separately grouped footer Licence route keep their previous topbar titles. Node and Chromium regression assertions cover grouping and topbar context.

**v0.59.1 Print Library readiness refinement:** A busy or reserved but online printer that matches the file's tool/material/nozzle requirements counts toward the file's Library `Ready now` preview, even if another idle matching-model printer is loaded with the wrong filament. Tooltip clarifies it is ready to queue and will start only when a compatible printer is idle and queue preflight passes. Never bypass queue safety; mismatches, unknown filament and offline printers do not make the file ready. Regression tests cover mixed fleet and single-busy cases.

**v0.59.1 Print Library label:** The nine-column Print Library desktop table now reads **Min. sell price**, with the same compact label in responsive cards and sorting choices; accessible sort name spells out minimum sell price per lot. No change to pricing calculations. **v0.59.1 workspace navigation simplification and headings:** Update the three routed-page blue eyebrows to FARM FILE LIBRARY, FARM PROTECTION and FARM CONTROLLER DIAGNOSTICS; leave modal edit headings and page titles unchanged. **v0.59.1 workspace navigation simplification:** On `feature/remove-workspace-breadcrumbs`, remove the redundant Workspace breadcrumb from all routed pages and fallback markup, and delete its now-unused Preact presentation component, event state and styling. Preserve active sidebar route, topbar title/subtitle, blue page heading and description, tabs/actions, desktop/mobile drawer keyboard semantics and browser history. Set topbar desktop min-height to 64px, mobile to 60px and shared content top gap to 18px/16px. Regression and browser tests updated to check the navigation and visual contract; merge only after user validation and CI passes. No printer/API/scheduler/cost logic changes.

**v0.59.0 release (PR #106):** Global hourlyCostRate (default 0, validated non-negative two-decimal rate) in Reports & finance → Pricing settings is applied to slicer-provided Print Library print duration. Print-time cost joins filament and sundry cost before profit, tax and per-lot rounding; the Print Library Sell price UI shows the time charge in Preact and fallback. Missing duration with a positive rate blocks quoting rather than underpricing. Currency comes from the complete filament estimate, without FX. Settings persist across backup/restore and older records default to zero. Node.js 24, Chromium Preact and container smoke gates passed on the feature head before release metadata update. Recheck gates after this version bump; merge PR #106 only once the new head is green. No printer commands or historical print-cost snapshots are changed.

**v0.58.1 release (PR #105):** Based on merged 0.58.0. Rename Reports & costing to Reports & finance, retaining /reports and its three tabs. Add global taxRate (0–100%, existing settings default to 0%), applied after profit percentage and before per-lot rounding. Print Library includes sortable Sale lots and tax-inclusive Sell price columns (per lot with multi-lot total shown), in Preact/fallback and responsive cards. Sundry lines use dropdown categories Packaging/Postage/Hardware/Labour/Miscellaneous, preserve legacy custom labels, show currency values with 2 decimals and use red outlined Remove actions without persisting until Save. Test with Node.js 24, Chromium Preact, MinIO and container smoke after the release version bump. No printer/queue logic changes. User requested release bump and merge PR #105; merge only following successful CI on the release commit.

**v0.58.0 release (PR #104):** The Print Library supports category/tags on upload, per-file sundry line items and 1–999 sale lots, with suggested selling prices based on complete current filament costs plus sundries. The sundry currency is always inherited from the resolved filament cost, never selected independently; legacy currency fields are ignored and stripped when edited. Global profit markup or gross margin settings live on the **Pricing settings** tab of renamed **Reports & finance** (alongside Analytics and Filament cost catalogue). The UI uses standard panels and scrollable dialog contents with fixed header and actions. Global pricing participates in backup/restore. No change to historical queue cost snapshots or printer dispatch/compatibility. User approved the merge of PR #104 after successful feature-head CI; updated to v0.58.0. Revalidate CI on the version-bump head before integration.

**v0.57.2 Print Library refinements:** PR #103 from `feature/library-clickable-readiness` adds clickable Readiness status badges for the five existing filter states, preserving other active filter facets and keyboard accessibility in both Preact and fallback. It also preserves the inner library list scroll on mouse/keyboard row selection and deselection while deliberate filter/sort/page changes still reset the view. Removes a 12px label-margin offset in the Advanced Filters sort controls, aligning the 42px Sort by, Ascending/Descending and Batch quantity inputs without changing global form styles. Unit/contract and Chromium geometry/interaction regression tests cover the fixes. User approved increasing version to 0.57.2 and merging PR #103; protect main by checking updated CI state before integration. No printer-control, queue-safety or scheduler changes.

**v0.57.1 Print Library hotfix:** On `hotfix/0.57.1` (PR #102), standardised Print Library printer filter names, corrected compatibility tooltips to report the designated printer's actual rejection reason instead of unrelated printer-model mismatches, and enabled category/tag badges to filter directly (Preact and fallback). Existing queue safety/format restrictions remain intact, including Snapmaker U1 accepting sliced G-code rather than 3MF uploads. User accepted the hotfix for merging after CI passed on the feature head; release metadata advanced to 0.57.1. Existing full regression and browser/container gates must pass on the version-bump commit before merging.

**v0.57.0 Print Library:** On feature branch `feature/print-library-improvements` (PR #101) users validated the new raw-filament cost estimates, selected-file action toolbar, shared table styling and fixed headings/buttons with scrollable contents. The release adds sorting, facets, category/tags/favourites, trustworthy slicer duration/gram estimates, batch material costs, 80-file pages and read-only queue-compatibility readiness. A compatible printer being offline now shows a neutral **Printer offline** badge, or **Printer busy** when temporarily occupied, instead of flagging the file **Needs attention**. Readiness follows fleet SSE through a throttled status-only endpoint; printer preflight still runs before dispatch. Node.js 24, Chromium Preact and container smoke gates passed on the feature head; release bump and merge tracked with PR #101. Physical-printer spot checks remain useful for live readiness transitions. The release intentionally omits versioned file revisions.

**v0.56.0 Phase 4.1:** Standardised Option A minimalist icon-and-underline tabs across all six existing tabbed views using new `public/tab-navigation.css` and shared Preact `UiTab`. Browser/mobile/light/dark/keyboard and Node.js regression contracts verify consistent Preact and legacy fallback behaviour. The Dashboard card/table toggle remains separate and unchanged. Printer Details (PR #99) also now has a rich image/icon identity header (model, connection, IP, reported firmware/uptime, connection health), retains six sections and original printer controls, and does not fabricate missing printer data. User tested and accepted PR #99 and Phase 4.1 PR #100. All feature branch checks (Node.js 24, Chromium, MinIO and container smoke) passed. Branch #100 was retargeted to main after PR #99 merged; release version advanced to v0.56.0 for the combined release. No printer firmware protocol or scheduling changes.

**v0.55.0 Phase 4:** Printer Details polish from `feature/preact-saas-printer-details` (PR #98) extends the light/dark SaaS design language into the printer modal. The header now makes printer name, model, host, status, maintenance and health clearer. Six existing tabs remain, with a single horizontally scrollable tab row on mobile, accessible labelled panels, keyboard navigation and a larger close touch target. Preact and vanilla fallback remain supported; no printer APIs, protocols, toolhead widths, aligned filament/nozzle controls or telemetry handling changed. Node.js 24, Chromium Preact and container smoke checks passed on the feature branch. Next: continue the SaaS polish cycle and validate interactions on actual U1/AD5M and experimental hardware as appropriate.

**Merged v0.54.0**: Preact SaaS design system and dashboard/shell polish, developed on `feature/preact-saas-design-system` (PR #96), are now on `main`. Phase 1 provides light/dark `--ds-*` tokens and Preact primitives in `public/design-system.css` and `ui/components.jsx`. Phase 2 adds `public/shell.css`, grouped SVG-icon sidebar, keyboard-safe responsive drawer and `ui/workspace-shell.jsx` breadcrumb linked to controller-owned navigation. Phase 3 adds `public/dashboard-polish.css` for Farm overview, four clickable stats and printer cards and a reactive Printers heading. All routes share a consistent heading style; Printer Groups uses `FARM ORGANISATION`; the Dashboard breadcrumb and subtitle are no longer duplicated. Table OFFLINE status and maintenance icon are fully visible after widening the status column, and mixed-length card headings share printer-image alignment via CSS subgrid.

**Quality:** Node.js 24 regression, Chromium Preact, MinIO integration, container smoke and multi-architecture image build passed on the final PR #96 head. CI uploads optional light/dark desktop/mobile screenshots using Node.js 24-compatible `actions/upload-artifact@v7`. Regression coverage spans headings across routes, Preact/legacy bridge, filters and table switching, mobile navigation, image alignment and the OFFLINE pill. Printer protocols, maintenance/queue/print APIs, concurrency protections and license limits are unchanged. See `docs/DESIGN_SYSTEM.md` for the UI design system, component and adoption rules.

**Next:** Continue subsequent polished SaaS migration phases after Phase 4, preserving model-specific filament/nozzle arrangements, all printer-side safety checks, accessibility and screenshot/layout regression checks.

v0.53.0 added Bambu A1 Mini external-spool and AMS Lite filament type/colour controls (PR #95); v0.52.0 added optional AMS slot configuration for P1P/P1S/X1C (PR #94). Physical Bambu hardware validation is still outstanding; preserve experimental designation. The A1 Mini retains its 80 °C bed limit, TLS/JPEG camera and no chamber controls.

The v0.48.1 regression audit was developed on `feature/regression-test-audit` (PR #90), based on the prior v0.48.0 baseline. Audit phase 1 inventories all 81 pre-audit regression-test files and classifies structural source assertions versus executable tests without equating a passing test with functional correctness. A standalone inventory command (`npm run test:audit`), its self-tests, and CI reporting were added. Findings and completion criteria live in `docs/REGRESSION_TEST_AUDIT.md`. No existing functional test was removed. Phase 2 has added behavioural suites for six-hour queue-priority aging, fixed-printer dispatch, review holds, per-printer activity policy, concurrency and lock recovery, with isolated deliberate fault-injection checks. The backup/recovery and licence batch added six restore integrity and five signed-license fail-closed tests with isolated recovery-hold and signature-verifier fault injections. A Chromium end-to-end browser regression now loads every persistent controller route, refreshes each route, checks reporting KPIs after refresh, navigates with sidebar/Back/Forward, verifies Preact live state rendering, and clicks a queue bed-clearance action against an isolated API fixture. It runs as a separate CI gate after building the optional Preact bundle. Source assertion overlap review removed six redundant source-only tests in total and two duplicate checks from the UI setup suite, retaining all 57 UI setup cases and legacy-renderer protections; replacement behaviour is covered by Chromium/runtime tests. An integrated simulated U1 is now registered with the running controller in Chromium: genuine protocol polling emits server SSE events and Preact updates the same printer card when the simulator starts a print. Both changes are documented in `docs/REGRESSION_TEST_AUDIT.md`. Next: maintain these quality gates with future changes, extend browser SSE/pointer interaction coverage where valuable, and continue validating unsupported hardware protocols.

The v0.48.1 patch release adds regression coverage and CI quality gates without changing controller runtime behaviour. Its v0.48.0 predecessor incorporated toolhead UI consistency work: uniform 160px filament/material/colour/nozzle dropdowns and Set filament/Assign buttons, consistent 8px type-to-colour spacing, AD5M nozzle dropdown beneath its label, and removal of unwanted Clear actions. The v0.47.2 frontend renderer diagnostics panel reports Preact initialisation and warns on legacy fallbacks; successful initialisation does not prove live rendering correctness.

This introduces Preact incrementally rather than rewriting the controller UI. The dashboard Preact layer now owns the summary filters, printer-group selector, Cards/Table view switch, printer cards and compact table rows. Live printer data is normalized into a presentation view model while the existing controller command/event delegation continues to own printer actions, selection, sorting, maintenance shortcuts and drag/reorder. A reusable Preact UI layer now provides shared buttons, status badges, progress bars, metrics and toast notifications for incremental migration of the remaining controller screens. Printer Details now uses Preact for its live header/status/activity chrome and six-tab navigation, while the specialist controls inside each tab remain on the existing controller DOM/event logic for this migration stage. Print Queue & History now uses Preact for live job, bed-clearance, production-batch and history-card rendering while retaining the existing queue scheduler endpoints and delegated control logic. Print Library file cards now use Preact for preview, metadata, printer-target, requirement, colour and action presentation while search and all library mutations continue through the established controller logic. Maintenance now uses Preact for the four view tabs plus model-wide, group-wide and individual-printer task presentation; the task form and all maintenance mutations remain in the established maintenance controller module. Alerts & Notifications now uses Preact for its three-tab navigation, alert-history table, destination cards and rule cards while acknowledgement, filtering, forms, tests and notification mutations remain in the existing alerts controller module. Reports & Analytics now uses Preact for its tabs, KPI cards, outcome chart, printer attention rows, ranked file/material bars and filament catalogue rows while report calculations, filters and filament form mutations remain in reporting.js. Backup & Recovery now uses Preact for its six-tab navigation, controller backup-status cards and restore-inspection result presentation while provider credentials, OAuth/device authorization, schedules, backup creation and restore staging remain in the established app controller logic. Printer Groups now uses Preact for group-card/member-list presentation while the existing multi-group editor and create/edit/delete logic remain in app.js. Diagnostics now uses Preact for controller-status and log-entry presentation while filters, verbose logging and diagnostic-bundle actions remain in the established app controller logic. Licence now uses Preact for licence-status and entitlement/detail presentation while signed licence upload, signature verification and activation remain in app.js. The v0.47.0 Preact migration audit confirms every persistent route page has Preact presentation coverage, and the dashboard over-limit licence notice is also Preact-rendered. Add Printer/discovery, Farm Operations action forms, Print Library filament-assignment editing, provider configuration forms and specialist Printer Details controls are intentionally retained on the established controller-managed DOM because they are stateful workflow/control surfaces rather than presentation-only remnants. Preact is bundled locally with esbuild for source, container and Windows SEA builds. A fresh source ZIP runs `npm install --include=dev` once to generate the optional browser bundle; `npm start` itself remains dependency-free and the existing HTML/vanilla-JavaScript dashboard remains usable if the Preact bundle is absent.

## Architecture

```text
Browser UI (`public/`; build-time Preact sources in `ui/`)
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
        +-- persistent reporting history + graphical analytics + filament catalogue/material-cost snapshots
        +-- logical `.pfcbackup` backup/recovery + scheduled local/network backups + staged restart restore/rollback
        +-- signed licence loader / verifier / edition + printer-slot enforcement
        |
        v
PrinterAdapter boundary (`src/adapters/`)
        +-- FlashForge Adventurer 5M / 5M Pro -> HTTP + TCP 8899 + MJPEG camera
        +-- FlashForge Creator 5 / Creator 5 Pro -> modern HTTP-only API + four-tool material station + MJPEG camera
        +-- Snapmaker U1 -> Moonraker / Klipper
        +-- Prusa CORE One+ -> local PrusaLink HTTP API (Digest/API-key auth)
        +-- Bambu Lab P1P / P1S / X1C / A1 Mini -> experimental MQTT/FTPS adapter; P1/A1 Mini TLS-JPEG camera

Development Printer Emulator (`emulator/`, loopback only)
        +-- management UI/API + SSE
        +-- shared virtual-printer state and scenarios
        +-- FlashForge AD5M HTTP/TCP/camera endpoints
        +-- FlashForge Creator 5 / Creator 5 Pro HTTP-only/camera endpoints
        +-- Snapmaker U1 Moonraker endpoints
        +-- Bambu P1P/P1S/X1C/A1 Mini MQTT TLS, FTPS TLS and camera test endpoints
        +-- Prusa CORE One+ PrusaLink HTTP/Digest-auth test endpoint
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

- Supported printers: FlashForge Adventurer 5M / 5M Pro, FlashForge Creator 5 / Creator 5 Pro, Snapmaker U1, experimental Prusa CORE One+, and experimental Bambu Lab P1P / P1S / X1C / A1 Mini support.
- Persistent printer registry with manufacturer-specific adapters, local discovery where supported, controller-side printer naming, live SSE fleet state, dashboard filtering and printer groups with overlapping membership.
- Persistent Print Library with descriptions, previews, target-printer metadata, material/colour/nozzle requirements, verified file distribution and queue integration.
- Persistent print queue/history with fixed-printer or next-compatible-printer assignment, priorities, production batches, reprint, compatibility/preflight checks, material/tool mapping and bed-clearance interlocks.
- Persistent reporting/analytics history with graphical trends, printer reliability indicators, popular-file reporting, filament usage/spend, and controller-owned filament catalogue costing with slicer-profile auto-matching.
- Maintenance tracking supports printer-, group- and model-scoped recurring tasks, due-soon/due status, per-printer history and controller-observed print usage.
- Backup & recovery on the production baseline uses portable verified/compressed `.pfcbackup` archives with local/NAS, Google Drive, generic S3-compatible and **Experimental Microsoft OneDrive** destinations, scheduled backups, explicit inspection, staged restart restore, rollback and recovery holds for unfinished queue work. v0.37.0 backups also include the filament catalogue and persistent reporting history.
- Google Drive production deployments use the shared built-in OAuth configuration injected at build time; customers authorize their own Google account without supplying an OAuth client. Advanced custom OAuth remains available for source/development or bespoke deployments.
- Offline Ed25519-signed licensing enforces physical-printer allowances: Community 3, Pro 10 and Farm 25; simulator printers do not consume licence slots.
- Integrated printer simulator covers FlashForge, Snapmaker and experimental Bambu protocol paths for repeatable development and automated validation.
- Production deployment supports the hardened Windows x64 Node SEA/installer path and the multi-architecture GHCR container image for `linux/amd64` and `linux/arm64`, with persistent `/data` and `/logs`.
- Known validation limits: Creator 5 / Creator 5 Pro physical-hardware validation remains incomplete; Bambu support remains experimental; X1C RTSPS/H.264 camera streaming is not currently supported.

## Current task

The current controller version is **v0.56.0** (including Preact SaaS design system, app shell, dashboard, Printer Details identity and unified tab navigation, and Bambu P1P/P1S/X1C/A1 Mini filament controls). The earlier v0.48.1 regression test validity audit was completed in `feature/regression-test-audit` (PR #90), based on v0.48.0. Phase 1 inventory and the completed queue scheduling/printer operation behaviour-audit batch are documented in `docs/REGRESSION_TEST_AUDIT.md`; backup recovery and signed-licence enforcement are now validated with executable temp-data scenarios; real Chromium browser/Preact route refresh and event-interaction checks are also now automated; source-only cleanup removed six redundant tests plus two duplicate assertions and actual simulator-to-browser SSE regression is complete; remaining optional work includes concurrent SSE-plus-pointerdown testing and model-specific real hardware validation.

v0.47.1 fixes direct browser refresh of routed controller pages after the v0.47.0 Preact presentation migration. v0.47.0 completed the first controller-wide Preact presentation migration. All persistent route pages now have Preact presentation coverage, with the Dashboard, Queue & History, Print Library, Maintenance, Alerts & Notifications, Reports & Analytics, Backup & Recovery, Printer Groups, Diagnostics and Licence interfaces migrated while preserving established controller/API behavior and vanilla fallbacks. Stateful Add Printer/discovery, Farm Operations forms, Print Library filament-assignment editing, provider authorization/configuration and specialist Printer Details controls remain deliberately on the established controller-managed DOM.

The v0.47.1 patch keeps the v0.47.0 UI architecture and corrects startup ordering so direct loads of non-dashboard routes initialize controller state before rendering the active route. The final dashboard summary presentation uses four filters without decorative heading dots and keeps each label aligned above its count. v0.47.2 adds fallback-safe frontend renderer diagnostics. The v0.48.0 milestone standardises printer filament/nozzle controls and their regression coverage.

## Next steps

1. Continue physical-hardware validation for Creator 5 / Creator 5 Pro and experimental Bambu support.
2. Keep the retained stateful controller-managed UI boundaries deliberate; migrate them only where there is a clear product or maintainability benefit.
3. Continue normal regression coverage for source, Windows SEA and multi-architecture container packaging as future features are added.
4. Keep `README.md`, `CHANGELOG.md` and this context file synchronized whenever a release/version changes.

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
