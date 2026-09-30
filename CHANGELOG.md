# Changelog

This file contains the version-by-version release history for Print Farm Controller.

Historical entries describe the behaviour of the controller at the time of that release and may be superseded by later versions. For current installation, configuration and supported-hardware guidance, see [README.md](README.md).

## v0.38.0

- Introduces a Stacked Layers branding prototype for the main controller header using a responsive vector interpretation of the supplied stacked-layer mark alongside the existing Print Farm Controller product name.
- The brand mark follows the current Light/Dark theme automatically and collapses cleanly on smaller screens.
- The existing embedded browser favicons are intentionally unchanged.

## v0.37.1

- Replaces the free-text filament catalogue currency field with a controlled dropdown covering **36 commonly used world currencies**, including GBP, USD, EUR, JPY, CNY, CAD, AUD, CHF, INR, BRL and other major regional currencies.
- New and changed filament catalogue entries are validated server-side against the supported currency list, while existing stored legacy three-letter currencies remain readable for backward compatibility and must be changed to a supported currency before saving through the UI.
- Adds UI and catalogue regression coverage for the supported currency choices.

## v0.37.0

- Adds persistent **Reports & analytics** with graphical daily outcome trends, date/printer/group filters, print outcome rates, run hours, popular-file reporting, filament usage/spend and transparent per-printer reliability indicators. Problem-printer guidance is based on observable counts/rates and recent-vs-earlier failure-rate trends rather than an opaque health score.
- Adds a persistent controller-owned filament catalogue with material, optional brand/product/colour, currency and cost per kg. Print Library files can explicitly map each logical tool to a catalogue entry, and sliced filament usage in grams is retained from supported G-code and embedded 3MF plate G-code.
- Adds Orca/Bambu slicer profile auto-matching for costing. Per-tool `filament_settings_id` and `filament_vendor` metadata are retained and used to select an unambiguous matching catalogue brand/product before falling back to a unique material-only match. Ambiguous matches continue to require explicit selection.
- Each print snapshots its material usage, catalogue identity, price/kg and estimated cost before start, so historical print costs remain stable when catalogue prices are changed later.
- Adds an independent persistent `reporting-history.json` store so long-term analytics are not limited by the recent queue/history retention window. Existing terminal queue history seeds the reporting store and subsequent terminal jobs are deduplicated by job ID.
- Portable backup/restore now includes the filament catalogue and reporting history in addition to Print Library metadata/files and print jobs. Older backups restore with backward-compatible empty defaults for the new stores.
- Adds regression coverage for filament gram/profile parsing, catalogue persistence, slicer-profile cost auto-matching, immutable cost snapshots, reporting aggregation, reporting UI wiring, and backup/restore participation.

## v0.36.0

- Experimental Microsoft OneDrive backup and restore is added on top of the v0.35.0 S3-compatible baseline. Backup & recovery now supports OneDrive for manual backups, daily/weekly scheduled backups with controller-scoped retention, and direct cloud restore through the same provider registry and unchanged inspection/staging/restart/rollback engine used by Google Drive and S3.
- Authentication uses Microsoft's device-code OAuth flow with delegated `offline_access Files.ReadWrite.AppFolder`. No Microsoft client secret is required, and PFC is limited to its dedicated OneDrive application folder. Production bundles can embed `PFC_MICROSOFT_CLIENT_ID`; source/development deployments can use a custom UI or environment client ID.
- OneDrive uploads use Microsoft Graph upload sessions and pair the verified `.pfcbackup` with a small PFC metadata sidecar used for safe installation-scoped retention. Microsoft refresh-token rotation is persisted safely, `<DATA_DIR>/integrations/one-drive.json` is excluded from backups/diagnostics, and short-lived access tokens remain memory-only.
- OneDrive is intentionally marked **Experimental** until live Microsoft account/Graph validation is completed. The reconciliation preserves the full v0.35.0 S3 implementation and MinIO CI integration. Automated coverage now validates Google Drive, OneDrive and S3 together in one controller baseline.

## v0.35.0

- Generic S3-compatible backup and restore. Backup & recovery can now store the canonical verified/compressed `.pfcbackup` in S3-compatible object storage for manual backups, daily/weekly scheduled backups with controller-scoped retention, and direct cloud restore through the existing provider registry and unchanged inspection/staging/restart/rollback engine.
- The S3 client is implemented with Node built-ins and AWS Signature Version 4, preserving the controller's zero runtime npm-dependency model. Configuration supports endpoint, bucket, region, object-key prefix, path-style or virtual-hosted addressing, and access-key credentials. HTTPS is required unless the user explicitly enables insecure HTTP for a trusted local development service such as MinIO.
- Each uploaded S3 backup has a small `.pfcmeta.json` sidecar containing PFC ownership/retention metadata. Scheduled retention therefore removes only older scheduled backups owned by the same controller installation while leaving manual and foreign-installation backups untouched. S3 credentials live under `<DATA_DIR>/integrations/s3.json`, are excluded from portable backups/diagnostics, and the secret key is never returned through the status API.
- Automated validation includes Signature V4/unit coverage plus an integration test that starts a pinned MinIO server and performs real bucket creation, upload, listing, restore download and retention operations.

## v0.33.0

- Cloud restore source support. Backup & recovery can now restore directly from connected cloud storage as well as a local `.pfcbackup`. The restore UI dynamically discovers cloud providers, lists eligible backups, requires explicit selection and inspection, downloads to temporary local staging, and then uses the unchanged existing restore inspection/staging/restart/rollback engine. Google Drive is the first provider. The selected cloud artifact is downloaded and revalidated again when restore is staged, and changing the selected source invalidates the previous inspection. The provider registry is intentionally generic so future cloud services can add list/download support without duplicating restore logic.
- Google Drive backup destination. Backup & recovery connects Google accounts through Google's limited-input/device OAuth flow with the narrow `drive.file` scope, creates and uses a visible **Print Farm Controller Backups** folder, uploads the existing verified/compressed `.pfcbackup` artifact manually or from the existing daily/weekly scheduler, tests connectivity, supports disconnect/reconnect, and applies retention only to scheduled backups created by the same controller installation. Production bundles can embed the shared Print Farm Controller OAuth client at build time from `PFC_GOOGLE_CLIENT_ID` / `PFC_GOOGLE_CLIENT_SECRET`, allowing normal customers to simply select **Connect** without creating their own Google Cloud project. GitHub Actions injects those values into production container builds through BuildKit secrets while pull-request builds receive none. Advanced custom OAuth configuration and runtime `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` overrides remain available. Built-in credentials are not copied into controller data; customer refresh-token/folder state and any deliberate custom override live under `<DATA_DIR>/integrations/google-drive.json`, access tokens remain memory-only, and integration state is excluded from portable backups and diagnostics. Local, mapped-drive and NAS scheduled destinations remain supported unchanged.

## v0.32.0

- Backup compression. Portable `.pfcbackup` files remain ZIP-compatible but now use streaming DEFLATE compression for JSON, G-code, text and other compressible payloads while keeping already-compressed formats such as 3MF and PNG/JPEG/WebP stored without recompression. Restore remains backwards-compatible with older method-0 backups and now accepts both ZIP STORE and DEFLATE entries. CRC-32 and SHA-256 continue to validate the uncompressed logical payload, and decompression is bounded by each entry's declared uncompressed size. No additional runtime dependency is required because compression uses Node.js `node:zlib`.

## v0.31.1

- Restore compatibility fix. Backup inspection now accepts a configured printer belonging to multiple custom printer groups, matching the multi-group membership model introduced in v0.28.0. Restore validation still rejects missing printers, duplicate group IDs/names, missing queue group references and missing maintenance group references. Backups created with valid multi-group membership can now be inspected and restored on replacement/container deployments.

## v0.31.0

- Container deployment baseline. The controller can run in a Node 24 Linux container with persistent `/data` and `/logs` mounts. Direct Snapmaker U1 and FlashForge AD5M Pro connectivity, including U1 camera access, has been validated through Docker Desktop. Container LAN discovery supports an optional bounded `DISCOVERY_SUBNET` CIDR (for example `192.168.1.0/24`): Snapmaker discovery actively probes Moonraker hosts on that subnet, while FlashForge discovery adds the subnet's directed broadcast plus bounded per-host UDP discovery probes, with an active TCP `~M115` identity fallback on port 8899 for Docker Desktop environments where UDP discovery replies do not traverse the virtual network. Native non-container discovery remains unchanged when the setting is omitted.

## v0.30.4

- Standardises licence storage in the controller data directory. Source/development and packaged deployments now use `DATA_DIR/license.json` as the canonical signed licence location. A valid legacy application-root `license.json` is verified before being automatically migrated into the data directory and the old copy is removed after a successful migration; invalid/tampered legacy files are never promoted. Licence installation/replacement also writes only to the canonical data location, and production ignores alternate licence-file environment paths. This gives Windows, source, Linux and future container deployments one persistent licence-storage model.

## v0.30.3

- Community Edition supports 3 physical printers. The unlicensed/Community fallback allowance is increased from 2 to 3 physical printers. Pro remains 10 and Farm remains 25. Simulator printers continue not to consume licence slots. Existing signed licences retain their explicitly signed `maxPrinters` value until deliberately reissued.

## v0.30.2

- Long-running memory stability and dashboard filter hierarchy. Dashboard live-event streaming now respects HTTP backpressure, coalesces pending fleet snapshots for slow or suspended clients and caps per-client buffering to prevent unbounded Node heap growth. Completed Bambu MQTT polling sockets are force-closed after DISCONNECT, and Diagnostics now exposes current V8 heap/RSS telemetry with warning, critical and danger logging thresholds plus recovery logging. The dashboard Printer group selector now appears above the summary/status filters, and the first summary filter is labelled **All Printers**. The full `npm test` suite passed and long-running memory utilisation was validated as stable before release.

## v0.30.1

- Circular dashboard filament swatches. Dashboard filament colour indicators now render as circles instead of rounded squares. Swatch size, spacing, tooltip metadata, `+N` overflow behaviour, Light/Dark styling and printer-card dimensions are unchanged.

## v0.30.0

- Sharper dashboard printer imagery. The eight bundled dashboard printer model assets have been upgraded from the reduced 260×124 versions to 400×190 transparent WebP images, matching the full height of the existing 190 px dashboard image well and avoiding browser upscaling that could make the printers look soft. The printer-card layout, model mapping, Light/Dark backgrounds, filament-colour overlay and live camera behaviour inside printer details are unchanged. The higher-resolution assets use high-quality WebP compression to retain fine printer detail while keeping the bundled files compact.

## v0.29.0

- Dashboard filament swatches. Dashboard printer tiles now overlay the currently loaded or controller-assigned filament colours on the existing printer-image area without increasing card height. Snapmaker U1 and FlashForge multi-tool printers use their live per-tool filament state; Bambu printers use the reported external-spool/AMS/AMS Lite material sources. Up to four 16 px colour swatches are shown with hover details for source/tool, material, colour and whether the value is printer-reported, RFID-detected or controller-assigned. Printers with more than four material sources show `+N` rather than wrapping onto another row, preserving tile alignment. Light and Dark themes have matching overlay treatments.

## v0.28.0

- Multi-group printer membership. A configured printer can belong to any number of custom printer groups at the same time. Adding a printer to one group no longer removes it from other groups. Dashboard group filtering, queue group restrictions and group-wide maintenance continue to evaluate the selected group independently, so the same printer can legitimately participate in several scheduling or maintenance groupings. Existing `printer-groups.json` files remain compatible; no data migration is required. The Printer groups editor shows a printer's other current memberships while editing a group.

## v0.27.0

- Dashboard model imagery. Dashboard printer cards use eight independent bundled WebP model images for AD5M Pro, Creator 5, Creator 5 Pro, Snapmaker U1, Bambu P1P, P1S, X1 Carbon and A1 Mini instead of polling live camera snapshots. Each image is rendered normally with `object-fit: contain` on a theme-aware dashboard surface, avoiding sprite cropping/positioning. Live camera streams, camera health and Restart camera remain available inside each printer's detail view. Unknown future printer models use a neutral dashboard fallback rather than a camera feed.

## v0.25.1

- Dashboard group filtering baseline. `feature/dashboard-group-filter-v0251` adds a **Printer group** selector to the main dashboard. Choosing a custom group restricts the visible printer cards to that group's current members, while the existing Printers / Online / Printing / Needs attention / Maintenance filters continue to work within the selected group. Summary counts and the maintenance-alert filter reflect the selected group, group membership changes update the dashboard selector/filter immediately, and **Show all printers** clears both the status and group filters. Maintenance task assignment also now starts the maintenance interval immediately: a newly assigned individual, group-wide, or model-wide task is treated as freshly serviced for scheduling purposes and cannot be completed until it reaches the existing **Due soon (80%)** threshold; no artificial completion-history entry is created.

## v0.25.0

- Printer groups baseline. `feature/printer-groups-v0250` adds controller-owned custom printer groups. A configured printer can belong to zero or one group; assigning it to a new group automatically moves it out of its previous group. The **Printer groups** window in the controller menu creates, edits and deletes groups and manages membership. **Next available compatible printer** queue jobs can optionally be restricted to a group; the normal compatibility, material/nozzle, licence, busy-state and bed-clearance checks still apply, but printers outside the selected group are not eligible. Group membership is evaluated live while a job waits, so moving printers between groups immediately affects future dispatch. Maintenance assignment now supports **Individual printer**, **Printer group**, and **Printer model**, with group-wide rules inherited by current group members while preserving independent per-printer baselines, completion state and history. Printer groups are persisted in `data/printer-groups.json` and participate in logical `.pfcbackup` backup/restore.

## v0.24.0

- Maintenance tracking baseline. Maintenance tracking is controller-owned and manufacturer-agnostic, with calendar-day, controller-observed print-hour, and observed print-cycle intervals. The Maintenance view includes **Add maintenance tasks**, **Model-wide maintenance rules**, **Group-wide maintenance rules** in v0.25.0, and **Individual printers**. The printer view shows current/due-soon/due tasks, observed usage and recent completion history, while edits automatically switch into the add/edit form. Each printer also has a confirmed **Clear history** action that deletes only its completion-history log; task schedules, last-completed state, usage counters, baselines and due status are preserved. Completing a task records an immutable history entry with optional notes and a usage snapshot before resetting that task's interval baseline. After a task has been completed on a printer, repeat completion is locked until that printer reaches the existing Due soon threshold at 80% of the interval; the UI disables Complete until then and the API enforces the same rule. Maintenance data is persisted in `data/maintenance.json` and is included in `.pfcbackup` backup/restore. Maintenance-store writes use a serialized temp-file replace with bounded retries for transient Windows `EPERM`, `EACCES`, and `EBUSY` rename failures, and a failed save no longer poisons later queued saves. Observed usage begins when this controller tracks the printer and is intentionally labelled controller-observed rather than manufacturer lifetime usage. Live maintenance state is also published with fleet updates: a top-bar alarm appears when any printer is Due soon or Due, shows the number of affected printers, and filters the dashboard to those printers when selected. Each dashboard printer card and printer-detail header shows a maintenance-status wrench icon, with the printer detail Maintenance panel also showing the current tracking summary. Dashboard cards reserve a consistent header height on multi-column layouts and a consistent one-line footer error slot, so model images and Open printer buttons remain aligned even when printer/model text wraps or only some printers have an offline error. The dashboard-card wrench and the matching wrench in the printer-details header are clickable: either shortcut opens Maintenance focused on that printer, preselects it for new printer-specific tasks, scrolls directly to its maintenance card, and briefly highlights it. Using the printer-details shortcut closes the printer-details dialog first.

## v0.22.0

- Colour-family queue matching baseline. Slicer hexadecimal colours are retained as shade metadata but automatic queue eligibility no longer requires an exact RGB/hex match. Required and loaded colours are classified into practical colour families (red, orange, yellow, green, cyan, blue, purple, pink, brown, black, white and grey). Same-family shades are compatible; different families remain blocked. FlashForge manual filament designation now uses colour family only; legacy saved hex-only designations are migrated logically by deriving their family, and saving a new manual designation clears the legacy exact shade. FlashForge, editable/non-RFID Snapmaker U1, and simulated Bambu AMS/AMS Lite/external-spool colour-family dropdowns render a matching square colour swatch inside every list option and the selected value. The U1 and Bambu simulator translate the selected family to a representative hex colour internally; official U1 RFID filament and real Bambu tray colours remain printer-reported. Real Bambu AMS/AMS Lite/external-spool telemetry retains the printer-reported exact hex but derives a colour family for compatibility and display. When multiple U1 tools or Bambu AMS sources satisfy the same material/nozzle/colour-family requirement, CIELAB colour distance is used only to prefer the closest shade.

## v0.21.0

- Print Library printer targeting. Print Library files can optionally be designated for a specific supported printer model. The target is selectable when adding a file, editable later, searchable/displayed in the library, copied into queued-job snapshots, and enforced by Next Available compatibility so a targeted file is only offered to matching printer models. Files with no target remain unrestricted.

## v0.20.2

- Dashboard click reliability. Live fleet updates no longer detach and reinsert every existing printer card when the card order is unchanged. This removes a browser click race where an **Open printer** button could be moved between pointer-down and click, making the action appear to do nothing intermittently.

## v0.20.1

- Printer-detail opening reliability. The printer dialog opens immediately with a loading state instead of waiting for the printer file-list request to finish. Slow printer storage access therefore no longer makes **Open printer** appear unresponsive. Stale asynchronous opens are discarded when the dialog is closed/reopened, and top-level open failures are surfaced instead of failing silently. Dashboard connection errors render below **Open printer**, keeping action buttons aligned across printer cards.

## v0.20.0

- Diagnostic logging. Controller-wide structured diagnostic logs are stored independently under `logs/` by default, with `LOG_DIR` available separately from `DATA_DIR` for container/PV deployments. The overflow menu includes **Diagnostics** for recent-log viewing/filtering, temporary 30-minute verbose DEBUG logging, and downloading a sanitized ZIP support bundle. Credential-like fields are redacted, print files and licence contents are excluded, and packaged Windows installs grant normal-user write access to both `data/` and `logs/`.
- `LOG_DIR` defaults to the application-local `logs/` directory and can be overridden independently (for example `LOG_DIR=/logs` in a container). Diagnostic logs are intentionally kept outside `data/` so the two locations can be mounted as separate persistent volumes.

## v0.19.0

- Printer activity status messaging. Printer detail windows now use the prominent activity banner introduced for Snapmaker U1 bed levelling as a general controller status surface. Controller-tracked bed levelling and calibration can be shown consistently across supported printer types, while chamber preheat is surfaced at the top of the printer window without duplicating its existing dashboard preheat strip.

## v0.18.0

- Concurrent client safety. Multiple browser clients can continue to monitor the same controller through the existing shared SSE/live-state backend, while conflicting writes are now coordinated centrally. Per-printer arbitration protects both overlapping controller transactions **and** longer-lived physical printer activity. A live compatibility matrix distinguishes idle, printing, paused, chamber-preheat, manual-heating, bed-levelling, calibration, fault and other busy states. Safe controls such as camera viewing, print pause/resume/cancel where appropriate, temperature/fan adjustments during a print, file upload, and heaters-off remain available while incompatible actions such as starting another print during levelling/calibration/preheat are blocked. This release does **not** add user accounts, authentication, roles or per-user audit history — connected clients still share the same controller authority.
- Hardens the controller for concurrent operators. Direct print/control commands, batch operations, file distribution, queue-driven starts/cancels, chamber preheat interactions, licence-slot changes, printer removal and compatibility designations share a per-printer operation coordinator. The coordinator now evaluates live printer state before each mutation, while controller-started bed levelling and U1 tool-offset calibration are tracked beyond the HTTP request so they remain protected for their physical workflow. U1 Moonraker `idle_timeout` macro activity is also surfaced to distinguish long-running printer macros from an actually idle machine. Print Library/queue mutations and printer-registry mutations are serialized, and printer/material/queue metadata persistence is hardened against concurrent read-modify-write loss and temporary-file collisions.

## v0.17.0

- Bambu Lab A1 Mini support. The existing experimental Bambu LAN adapter now supports A1 Mini configuration, status/control, FTPS file handling, TLS/JPEG camera access and AMS Lite material mapping. Single-material `.gcode` starts are enabled on A1 Mini using the existing Bambu `gcode_file` path, but remain experimental until validated on physical hardware; multi-material AMS Lite jobs require sliced `.3mf`. A1 Mini support remains experimental until validated on physical hardware.
- Adds experimental Bambu Lab A1 Mini support. A1 Mini uses the existing Bambu MQTT TLS/FTPS integration, the same TLS/JPEG camera path used by P1-family printers, a model-specific 80 °C maximum bed limit, and single-nozzle AMS Lite mapping through the existing Bambu material-source workflow. The controller supports `.3mf` plus single-material `.gcode` on A1 Mini; raw G-code start remains explicitly unverified on physical A1 Mini hardware. The integrated Printer Simulator includes an A1 Mini profile for controller testing.

## v0.16.1

- Aligns dashboard available-state colours and Print Library preview presentation. Idle and Ready printer badges on the main dashboard are green in both Dark and Light modes, while existing warning/error colours remain unchanged. Print Library thumbnail and enlarged preview backgrounds now use the existing Light-mode preview colour (`#f3f7fa`) in both themes so model images are presented consistently.

## v0.16.0

- Adds production packaging. The controller can now be bundled into a hardened Windows x64 Node SEA executable with embedded UI, simulator resources and trusted licence verification keys. The release includes an Inno Setup 7 installer for Program Files deployment, writable application-local `data/`, packaged licence storage at `data/license.json`, and an optional Authenticode signing workflow for future production releases.

## v0.15.6

- Adds dashboard fleet filtering and consolidates the latest controller usability/storage improvements. The Printers, Online, Printing and Needs attention summary cards can filter the dashboard fleet in place; the active filter is highlighted, filtering stays in sync with live printer/queue state, and an empty-filter state provides a quick return to all printers. This build also includes application-local `data/` storage, consistent **Snapmaker U1** model naming, and the combined printer-card hover/focus highlight treatment.

## v0.15.5

- Adds visual previews to the Print Library. The controller extracts and caches slicer-provided preview images when available, using Orca/Bambu-style 3MF plate thumbnails (including `Metadata/plate_1.png` and related fallbacks) and embedded PNG/JPEG G-code thumbnail blocks. Library cards show a compact preview beside the file details; clicking it opens a larger viewer. Existing library files are backfilled automatically the first time they are read, and files without a supported embedded image show a **No preview** placeholder. Preview images are cached as separate files beside the stored print file rather than embedded into `metadata.json`.

## v0.15.4

- Adds free-text metadata to Print Library files. When adding a file, users can optionally enter up to 4000 characters of description/notes explaining what the part is, its intended use, print guidance or other context. Notes are displayed on library cards, included in library search, can be edited later with **Edit details**, and are also available when uploading a new file through the queue workflow.

## v0.15.3

- Preserves the red Offline/Error printer status treatment in Light mode. The generic light-theme badge styling no longer overrides these warning states.

## v0.15.2

- Simplifies the controller top bar with a responsive overflow menu. The Light/Dark toggle remains permanently visible. Printer simulator and Licence move into a compact **⋮** menu, while Fleet operations stays visible on wider screens and automatically moves into the same overflow menu when horizontal space is tighter.

## v0.15.1

- Adds detected filament colours to Print Library entries. When colour metadata is available in the G-code/GX/3MF requirements, each library card now lists the actual colours with a swatch, hexadecimal value and RGB value.

## v0.15.0

- Introduces the persistent Print Library. Controller-owned G-code/GX/3MF files are now durable independently of the queue and history. The dashboard exposes a searchable **Print library** browser where files can be uploaded, inspected for detected material/nozzle/tool requirements, queued to the next compatible printer, or explicitly deleted when no queue/history record still references them. Existing `queue-files/` entries migrate automatically into `print-library/` while retaining their UUIDs, so current queue/history records remain valid. Uploading the same file content again reuses the existing library entry by SHA-256 instead of storing a duplicate.

## v0.14.12

- Standardises the Snapmaker model name in the controller UI. Snapmaker U1 printers display as **Snapmaker U1** on dashboard cards and in printer-details diagnostics, while the stored model remains `U1` and the adapter identity remains unchanged.

## v0.14.11

- Aligns the simulated FlashForge material telemetry with physical AD5M-family behaviour. The simulator still tracks its virtual filament internally, but its FlashForge `/detail` response no longer claims that the printer reports a loaded material type by default. This makes the controller show **Clear designation** instead of **Use printer value** unless a real printer-reported value is actually available.

## v0.14.10

- Adds hover/focus colour feedback to all enabled buttons. Dark mode brightens buttons under the pointer or keyboard focus, while light mode slightly darkens them. Disabled buttons are unchanged.

## v0.14.9

- Renames the application from Printer Fleet Controller to Print Farm Controller. The browser title, dashboard header/footer, controller messages, simulator wording and documentation now use **Print Farm Controller**. Existing application-data directories and machine-facing compatibility identifiers retain their historical `Printer Fleet Controller` / `printer-fleet-controller` names so upgrades, scripts and integrations continue to work without migration.

## v0.14.8

- Adds production-hardened offline signed licensing. The controller verifies Ed25519-signed `license.json` files and fails closed to Community Edition when no valid licence is installed. Community permits 2 physical printers, Pro 10 and Farm 25; simulator printers do not consume licence slots. Existing printers are never deleted if a licence allowance is reduced. Licence installation/replacement is available from the controller UI and takes effect without restarting. Production startup ignores environment-variable attempts to elevate the edition or trust an arbitrary signing key.

## v0.14.x

- also establishes the controller's edition/entitlement model for future feature gating. The signed licence carries its edition, physical-printer allowance and optional additional feature entitlements. The current production enforcement path includes signed-licence verification and physical-printer slot limits; further feature-by-feature gating can be layered onto the defined entitlement model without changing the licence-file format.

## v0.13.0

- now includes an **experimental Bambu Lab P1P/P1S/X1C controller adapter**. It reads LAN status and external-spool/AMS telemetry, maps sliced 3MF filaments to loaded AMS slots, and sends print/job/temperature/fan commands over MQTT TLS. It also performs verified `.3mf`/`.gcode` storage operations over implicit FTPS. P1 cameras feed the existing dashboard camera manager; physical X1C camera decoding is not yet supported because X1C supplies RTSPS/H.264 rather than the P1 TLS/JPEG stream. The implemented workflows are tested against the Bambu emulator but have not been validated on physical Bambu hardware.
- includes a controller-managed, loopback-only **Printer Simulator** with its own responsive light/dark UI. It can run multiple simulated FlashForge Adventurer 5M Pro, Snapmaker U1, Bambu Lab P1P, P1S and X1C endpoints, exercise the controller's production adapters, accelerate print progress, manage virtual files and temperatures, and inject repeatable connection, cancellation, verification, camera, material and nozzle faults. Simulator support is a development aid and does not replace final validation on physical hardware.

## v0.12.16

- adds a combined **Snapmaker U1 third-party filament type and colour control** to each toolhead card. One **Set filament on U1** button sends the selected generic material profile and colour together using stock `SET_PRINT_FILAMENT_CONFIG`; the controller verifies both values and immediately uses them for queue compatibility. The control is available only for idle, loaded, editable third-party slots, while official RFID filament remains locked. The combined workflow has been validated on physical U1 hardware.

## v0.12.15

- moves production-batch controls into a dedicated full-width row below the batch copy list, preventing Pause/Resume, priority, quantity and cancellation controls from overlapping batch items at narrower queue widths.

## v0.12.14

- adds persistent **High / Normal / Low queue priorities** for individual jobs and production batches. The scheduler ranks priority before manual order, promotes waiting work one level every six hours to prevent starvation, prefers a compatible printer where the file is already verified, and records why a printer was selected.

## v0.12.13

- adds an accessible **Light / Dark** appearance switch in the main header. The selected theme is saved in the browser; before a choice is made, the interface follows the device colour-scheme preference.

## v0.12.12

- prevents a newly assigned queue job from inheriting the previous print's retained 100% progress. A job remains **Starting — 0%** until an active printer state confirms the new print, including when the same filename is reprinted; progress is then tracked only from the confirmed new run.

## v0.12.11

- presents FlashForge's latched `CANCEL` result as **Cancelled** while bed clearance is pending and **Ready** after acknowledgement. The raw printer status remains visible in the printer detail diagnostics and is not altered or reset on the printer.

## v0.12.10

- fixes FlashForge queue recovery when the printer retains `CANCEL` and the cancelled filename. Cancelled states now create or retain a bed-clearance interlock, then become startable only after the operator confirms the bed is clear. This also covers prints cancelled outside the controller.

## v0.12.9

- fixes Snapmaker U1 queue availability after a completed print. Moonraker may retain the previous filename after reporting an idle/complete state; the queue now treats the explicit idle state as authoritative while continuing to enforce the separate bed-clearance interlock.

## v0.12.8

- adds **native Snapmaker U1 filament colour editing** for manually assigned third-party filament. Toolhead status can write a selected colour to the idle U1 using its stock `SET_PRINT_FILAMENT_CONFIG` command, verifies the printer read-back, and keeps official RFID filament colours locked.

## v0.12.7

- shows FlashForge controller-assigned filament colours as both hexadecimal and **RGB(r, g, b)** values in Toolhead status. The stored colour and automatic queue compatibility behaviour are unchanged.

## v0.12.6

- keeps the Snapmaker U1 hexadecimal filament colour on the main toolhead metadata line and moves **RGB(r, g, b)** onto its own line so the value fits cleanly inside each toolhead status card. Print setup and material preflight keep the combined hex + RGB display.

## v0.12.5

- shows Snapmaker U1 filament colours as both hexadecimal and **RGB(r, g, b)** values in toolhead metadata, material preflight, and physical-head choices.

## v0.12.4

- adds a persistent **filament colour designation** alongside material type for FlashForge printers. The printer window now provides a colour picker; the controller-normalized tool state and automatic queue compatibility use the assigned colour, including blocking explicit colour mismatches.

## v0.12.3

- adds **Upload file** inside each supported printer window. Individual uploads use the printer adapter's declared file types, are verified in printer storage before reporting success, save available material metadata, and refresh the printer file list after upload.

## v0.12.2

- adds **Reprint batch** to finished production batches in Recent history. Reprinting creates a new automatic production batch with the same quantity, staged controller file and print options while preserving the original history.

## v0.12.1

- adds dedicated regression coverage ensuring a cancelled queued print remains in Recent history and can be reprinted with its original staged file and print options.

## v0.12.0

- adds **production quantity / batch printing**. A single staged G-code can represent 2–999 copies, with copies automatically distributed across compatible idle printers. Production batches expose overall progress, per-copy printer/status, pause/resume, cancel remaining copies, and safe quantity changes while retaining existing bed-clearance and preflight protections.

## v0.11.3

- makes **Clear history** immediately delete controller-staged queue files that are no longer referenced. Files still referenced by queued/active/review jobs, retained bed-clearance records, or another history item are preserved. The normal one-hour orphan grace period remains in place for non-explicit cleanup paths. **This is historical behavior and is superseded by v0.15.0:** migrated Print Library files are no longer pruned by queue/history cleanup and require explicit deletion.

## v0.11.2

- moved the default controller application-data directory to the then-current manufacturer-neutral **Printer Fleet Controller** path. Current builds now store runtime data in the application-local `data/` directory instead of the user profile. On first startup, existing data is migrated automatically from the former profile location (or the older `FlashForge Fleet` location), including printer configuration, queue/history, Print Library files, emulator settings and material metadata. Custom `DATA_DIR` locations are unchanged.

## v0.11.1

- adds a persistent **Controller nozzle designation** for FlashForge 5M-family printers. Set the installed nozzle diameter in Toolhead status so file-centric automatic queue compatibility can safely match staged G-code nozzle requirements instead of holding FlashForge jobs for review when the local API cannot report nozzle size.

## v0.11.0

- adds a file-centric **Next available compatible printer** queue. The controller can persistently stage an uploaded G-code file, inspect its tool/material/colour/nozzle requirements, evaluate the live fleet, choose an eligible idle printer with a clear bed, upload and verify the file, run a fresh printer-specific preflight, and then start it. Existing fixed-printer queue jobs remain supported.

## Historical packaging validation

- Packaging validation: the hardened Windows x64 single-executable build has been manually validated successfully with embedded controller UI, simulator resources and trusted licence public keys.
- Installer validation: the Inno Setup 7 Windows installer has been built and manually validated successfully under Program Files, including normal non-admin runtime writes to `data/` and packaged licence storage at `data/license.json`.

