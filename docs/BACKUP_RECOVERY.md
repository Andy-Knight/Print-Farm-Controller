# Backup and Recovery Design — v0.23.0

## Purpose

v0.23.0 adds controller-owned backup and disaster recovery for Print Farm Controller. The goal is to recover a controller after accidental configuration loss, a failed PC, or migration to a replacement machine without manually rebuilding printers, Print Library contents, queue/history, metadata, simulator settings, or the installed signed licence.

The backup format is intentionally logical and path-independent. A backup is not a raw copy of the application directory or `data/` directory.

## Scope for v0.23.0

### Included

- Manual backup from the controller UI.
- Scheduled backup to a local folder or an operating-system-mounted/network path such as a Windows UNC/NAS location.
- Configurable scheduled-backup retention.
- Portable `.pfcbackup` package.
- Manifest, format version, source controller version, counts and SHA-256 integrity checks.
- Restore validation before any live data is changed.
- Staged/atomic restore with automatic rollback if activation fails.
- Safe queue recovery: restored unfinished work cannot automatically start.
- Recovery across machines and forward across supported controller versions.
- Backup/restore status and errors in the UI and diagnostic log.

### Deferred

- Cloud-provider-specific destinations.
- Built-in backup encryption/password protection.
- Incremental/differential backups.
- Remote replication between controller instances.
- Automatic executable/application rollback.

## Backup package

Extension:

```text
.pfcbackup
```

Container:

- ZIP-compatible archive.
- Backup format identifier: `print-farm-controller-backup`.
- Initial format version: `1`.
- Example filename:

```text
PrintFarmController-20260924-163000Z-v0.23.0.pfcbackup
```

Logical layout:

```text
manifest.json
checksums.json

state/
  printers.json
  print-jobs.json
  file-material-metadata.json
  emulator-settings.json          # optional
  backup-settings.json            # optional, schedule restored disabled
  maintenance.json                # maintenance tasks, history and observed usage
  license.json                    # optional signed customer licence

print-library/
  <library-id>/
    metadata.json
    <original-print-file>
    preview.png|preview.jpg        # optional
```

The archive must never contain absolute host paths.

## Manifest

`manifest.json` records at least:

- backup format identifier and format version;
- backup UUID;
- UTC creation timestamp;
- source Print Farm Controller version;
- source platform/runtime information useful for diagnostics;
- persistent installation ID;
- whether the backup was manual or scheduled;
- counts for printers, Print Library entries, queue jobs and history;
- whether a signed licence is included;
- payload byte count;
- queue restore policy;
- feature/schema versions needed for migration.

The manifest contains no private signing material.

## Integrity

`checksums.json` contains SHA-256 and byte size for every payload entry and the manifest.

Backup creation is successful only when:

1. every expected payload entry has been written;
2. all hashes have been calculated;
3. the completed archive can be reopened;
4. the manifest and payload checksums verify;
5. the temporary archive is renamed to its final filename.

A failed backup must never leave a file that looks like a valid completed `.pfcbackup`. Temporary files use a distinct `.tmp` suffix.

Checksums provide corruption detection, not cryptographic authenticity.

## Data included

### Printer configuration

Back up the logical contents of `printers.json`, including:

- printer definitions;
- adapter/model settings;
- network endpoints;
- printer credentials/access codes already stored by the controller;
- dashboard ordering;
- licence-slot selection;
- controller-side material/nozzle designations.

### Print Library

Back up every durable Print Library entry:

- original print file;
- metadata;
- free-text description;
- target-printer designation;
- parsed requirements;
- cached preview where present;
- stored SHA-256/content metadata.

The Print Library remains the durable source for controller-owned print files after restore.

### Queue and history

Back up `print-jobs.json`, including:

- queued jobs;
- production batches;
- priorities/order;
- history;
- compatibility snapshots;
- bed-clearance state;
- Print Library references.

Restore safety rules are described below.

### File material metadata

Back up controller-remembered per-printer file material metadata.

### Emulator settings

Back up integrated simulator enablement/settings where present. Restoring emulator settings does not turn simulator-only validation into physical printer validation.

### Maintenance tracking

Back up controller-owned `maintenance.json`, including recurring maintenance tasks, completion history, task interval baselines and controller-observed print-hour/print-cycle counters. These counters are controller observations rather than manufacturer lifetime odometers. Older backups without maintenance state restore with an empty maintenance store rather than retaining maintenance records from the target installation.

### Licence

The installed signed customer `license.json` may be included.

- It remains subject to normal signature, expiry and edition validation after restore.
- Restoring it does not bypass licence-slot enforcement.
- No private Ed25519 signing key is ever part of a controller backup.
- The separate `Print-Farm-Licensing` repository/data is outside this backup system.

### Backup policy

Back up backup-policy configuration so retention/path preferences can be recovered, but scheduled backup execution is restored **disabled** until the user explicitly confirms/re-enables it on the recovered installation. This prevents an old machine-specific or network path from being used unexpectedly.

## Data excluded

v0.23.0 excludes:

- application executable/source/bundled UI files;
- `node_modules`;
- build/release artifacts;
- operating-system temporary files;
- controller diagnostic `logs/`;
- generated diagnostic ZIP bundles;
- transient upload/staging files;
- transient camera frames;
- runtime locks/reservations;
- in-memory printer state;
- private licence signing keys or License Manager data.

Diagnostic logs have their own sanitized diagnostic-bundle workflow and are deliberately separate from disaster-recovery backups.

## Logical snapshot model

Backup creation must use controller-owned logical stores rather than blindly copying the live data directory.

Reasons:

- portable across source and packaged installations;
- independent of `DATA_DIR`;
- avoids stale temporary files;
- allows schema migration;
- makes package contents explicit and testable.

Current JSON stores are already written using temp-file + rename semantics, so each store can be read atomically.

The Print Library uses immutable file IDs/content. Queue/history references protect referenced library entries from deletion. Backup code should still tolerate a concurrent unreferenced library change by retrying or omitting an entry only when it was removed before the snapshot was finalized.

A backup must not send printer commands or interrupt an active physical print.

## Restore validation

No current state is changed until all validation passes.

Validation includes:

- valid ZIP/container structure;
- correct backup format identifier;
- supported backup format version;
- valid JSON schema/shape for required state files;
- no absolute paths or `../` path traversal;
- file count and uncompressed-size limits;
- SHA-256/size verification for every archive payload;
- Print Library IDs and metadata/file relationships are valid;
- queue Print Library references resolve;
- source controller version is supported;
- sufficient local staging space.

### Version rule

- Restoring a backup from the same or an older supported controller version into a newer controller is allowed through explicit migrations.
- Restoring a backup created by a newer controller into an older controller is blocked.
- Backup-format migration and application-data migration are separate versioned concerns.

## Restore safety

### Active printer work

An in-place restore is blocked while any physical printer is actively printing or while the controller has a physical workflow in progress, including controller-tracked bed levelling, calibration or chamber preheat.

The user must allow the activity to finish or cancel it normally before restore can be staged.

### Queue recovery hold

The controller must never automatically resume unfinished work merely because a backup was restored.

On restore:

- terminal history records remain terminal;
- bed-clearance interlocks are preserved and are never auto-cleared;
- any non-terminal queue job is marked with an explicit restore/recovery hold;
- transient assignment/reservation/start state is cleared;
- restored production batches are paused;
- no restored held job is eligible for automatic dispatch.

The UI exposes a clear **Restored — review required** state and a deliberate action to recheck/release restored work after printer connectivity, material/nozzle state and bed clearance have been reviewed.

This is safer than pretending a job that was `printing`, `uploading`, `preflight` or `starting` at backup time is still active after disaster recovery.

## Atomic restore model

Restore is two-phase.

### Phase 1 — validate and stage

While the current controller remains intact:

1. open the selected `.pfcbackup`;
2. validate manifest, format and checksums;
3. migrate the logical backup into the current schema in a staging directory;
4. apply queue recovery holds;
5. validate the fully staged controller state;
6. create an internal rollback snapshot of the current persistent controller state;
7. write a pending-restore marker.

No live persistent state is replaced in Phase 1.

### Phase 2 — activate on restart

Restore activation occurs before normal persistent stores and printer services initialize.

1. detect the pending-restore marker;
2. verify the staged state again;
3. rename the current data directory to a rollback location on the same filesystem;
4. atomically rename the staged data directory into place;
5. preserve/restore the appropriate signed licence location;
6. start normal application initialization against the restored data;
7. after successful initialization, retain the rollback snapshot for a short recovery window and then remove it according to policy.

If activation fails, the controller restores the pre-restore data automatically and records the failure.

A restore therefore requires a controller restart. The UI must say this explicitly rather than implying an in-memory restore is complete.

## Disaster-recovery workflow

For a failed/replaced controller PC:

1. install the same or a newer supported Print Farm Controller version;
2. open **Backup & Recovery**;
3. select the `.pfcbackup`;
4. review the validation summary;
5. stage the restore;
6. restart Print Farm Controller;
7. verify printer addresses/connectivity and licence status;
8. review restored queue items held for recovery;
9. confirm bed clearance/material/nozzle state;
10. deliberately release/recheck queue work.

Print Library files and controller configuration should require no manual recreation.

## Backup destinations

### Manual backup

The user chooses where to save the package.

### Scheduled backup

Configuration includes:

- enabled/disabled;
- destination directory;
- frequency/time;
- retention count;
- last successful backup;
- last attempted backup/error;
- installation ID.

Any path the host OS can write is supported. On Windows this includes a mapped drive or UNC/NAS path when the controller process has permission.

The controller must test destination writability before enabling a schedule.

## Scheduling and retention

Initial scheduled options:

- daily;
- selected days/weekly.

The schedule is disabled by default.

Retention is count-based in v0.23.0, with a configurable number of scheduled backups to keep. A reasonable UI default is 14 when scheduling is enabled.

Retention rules:

- only backups created as **scheduled** backups by the same controller installation are automatically pruned;
- manual backups are never pruned automatically;
- prune only after a new scheduled backup has been fully written and verified;
- never delete the newest valid backup;
- a retention failure does not invalidate the successful backup.

## Installation ID

v0.23.0 introduces a persistent random installation UUID used only for backup ownership/retention and diagnostics.

It is not:

- a licence identifier;
- a hardware fingerprint;
- an external tracking identifier.

It may be restored to a replacement machine so scheduled-backup retention can continue to identify its own backup set.

## Security

Backups are sensitive because they can contain:

- printer IP/host configuration;
- printer access codes/credentials;
- Print Library files;
- queue/history information;
- the signed customer licence.

v0.23.0 therefore:

- writes backup files with restrictive permissions where supported;
- never sends backups to an external service;
- never contains private licence signing keys;
- warns that unencrypted backups should be stored on trusted storage;
- validates archive paths and size limits before extraction.

Built-in encryption is a later feature; do not describe v0.23.0 checksums as encryption.

## UI

Add **Backup & Recovery** to the controller's existing overflow/settings area.

The panel should show:

- last successful backup;
- scheduled backup status;
- configured destination;
- next scheduled backup when enabled;
- **Create backup now**;
- **Restore backup**;
- schedule/retention controls;
- recent backup failure message if applicable.

Restore review should show:

- backup date;
- source controller version;
- backup format version;
- printer count;
- Print Library file count and size;
- queued/history counts;
- licence included/not included;
- warnings/migrations;
- explicit notice that unfinished queue work will be recovery-held;
- explicit notice that restart is required.

## Diagnostics

Backup/recovery operations use the existing diagnostic logger.

Log:

- backup start/success/failure;
- destination type/path with sensitive components redacted where appropriate;
- payload counts/bytes;
- restore validation result;
- migration versions;
- staging/activation/rollback result;
- scheduled retention result.

Do not log printer credentials, licence contents or Print Library file contents.

## API/service boundary

Backup/recovery logic belongs in a dedicated backend service rather than browser code.

Suggested modules:

```text
src/backup-recovery/
  backup-service.js
  backup-format.js
  backup-archive.js
  restore-service.js
  restore-bootstrap.js
  backup-settings-store.js
  migrations.js
```

The server/UI should call this service through explicit API endpoints.

Suggested endpoints:

```text
GET    /api/backup/status
POST   /api/backup/create
GET    /api/backup/download/:id        # for browser-created manual backup where applicable
GET    /api/backup/settings
PUT    /api/backup/settings
POST   /api/restore/inspect
POST   /api/restore/stage
```

Exact endpoint shapes may be adjusted during implementation, but backup logic must remain outside the browser.

## Concurrency rule

Backup/recovery must respect the existing concurrent-client safety model.

- Only one backup creation may run at a time.
- Only one restore inspection/staging operation may run at a time.
- Restore staging conflicts with controller mutations that would invalidate recovery state.
- Restore activation happens at startup before normal printer/queue activity.
- A scheduled backup and manual backup cannot run simultaneously.
- Failed operations release their locks.

## Testing requirements

At minimum cover:

### Backup

- empty/fresh controller;
- multiple printer manufacturers;
- Print Library entries with and without previews;
- large/binary print file;
- queue/history and production batches;
- file material metadata;
- emulator settings;
- signed licence present/absent;
- scheduled destination unavailable;
- backup destination write failure;
- concurrent manual/scheduled request;
- integrity verification;
- no logs/private keys/transient files included.

### Restore

- valid same-version backup;
- supported older-version migration;
- newer-version backup rejected by older controller;
- corrupt archive;
- checksum mismatch;
- path traversal;
- missing library payload;
- unresolved queue/library reference;
- active print blocks staging;
- recovery hold on every non-terminal queue state;
- production batches restored paused;
- bed-clearance state preserved;
- signed licence revalidated normally;
- staged activation success;
- forced activation failure rolls back;
- interrupted restore leaves original data usable.

### End-to-end disaster recovery

A test should create controller state in one temporary data directory, produce a backup, restore it into a separate fresh data directory, restart/reinitialize services, and prove that:

- printers match;
- Print Library content hashes match;
- metadata matches;
- history matches;
- unfinished queue work exists but cannot auto-start;
- licence validation still follows normal rules.

## Implementation status

Stages 1–6 are implemented on `feature/backup-recovery-v0230`:

- dependency-free ZIP32-compatible archive writer using stored entries and data descriptors;
- streaming SHA-256/CRC verification of completed archives;
- `manifest.json` and `checksums.json` generation;
- persistent installation UUID and backup-settings foundation;
- logical snapshot export of the known controller stores and Print Library;
- optional signed licence and emulator settings inclusion;
- archive corruption, path-independence and inclusion/exclusion tests;
- manual backup status/create API;
- one-at-a-time manual backup creation with verified server-side staging;
- one-time tokenized streamed download that removes the staging copy after a successful transfer;
- stale manual staging cleanup on controller startup;
- diagnostic logging for manual backup creation/download;
- Backup & Recovery overflow-menu entry and manual-backup UI;
- explicit UI warning that v0.23.0 backups are integrity-checked but not encrypted;
- read-only restore upload/inspection API and UI;
- exact checksum coverage enforcement (hidden/unchecksummed archive entries are rejected);
- absolute, UNC-style and traversal archive-path rejection;
- restore validation of format/schema/controller versions, manifest counts and payload size;
- state JSON shape validation and optional signed-licence/emulator-settings validation;
- Print Library ID/file/preview/size/SHA-256 relationship validation;
- queue-to-Print-Library reference validation;
- local staging-space check where the platform exposes filesystem free-space information;
- explicit rejection of backups created by a newer controller version;
- restore summary showing counts, warnings and migration requirement without mutating live state;
- read-only inspection enables **Restore backup** only after a valid inspection;
- restore staging revalidates the selected backup and extracts a logical staged data set without changing live data;
- queue dispatch is paused before restore safety checks so a queued job cannot race staging;
- staging is blocked while physical prints, controller queue work, chamber preheat, tracked printer activity or in-flight printer operations are active;
- once staged, controller and simulator mutations are frozen until restart or explicit staged-restore cancellation;
- all non-terminal jobs are transformed to **Restored — review required** with an explicit recovery hold;
- restored production-batch runs are paused;
- jobs that were starting/printing force bed clearance; automatic jobs that may have printed retain the last physical printer until that bed is acknowledged clear;
- recovery-held fixed-printer jobs require fresh live compatibility before release; automatic jobs re-enter normal scheduler compatibility only after deliberate recheck;
- restore stage/rollback/journal data lives under `data/.restore-control/`, avoiding any requirement for normal users to create sibling folders in the surrounding Program Files directory;
- activation transactionally swaps the known controller-owned persistent entries within `data/`, while transient/runtime folders are left outside the restored logical state;
- restore activation is journalled through `staged -> activating -> installing -> activated -> committed` and occurs before normal controller stores/printer services initialize;
- failed startup before commit automatically restores the previous data and external signed-licence state;
- an interrupted `activating`/uncommitted `activated` journal is rolled back on the next startup;
- successful restored startup retains the pre-restore snapshot for a 24-hour recovery window;
- committed rollback state is discarded when its recovery window expires on a lifecycle check or when a newer restore is staged;
- pending-journal filesystem paths are validated against controller-owned sibling restore paths before cleanup/rename;
- staging can be cancelled before restart, leaving current controller data unchanged.

- scheduled backup settings/API/UI support daily or weekly execution at a controller-local time, with weekday selection for weekly schedules;
- scheduler startup detects the most recent missed due slot and queues a catch-up backup shortly after startup when the slot belongs to the current effective schedule and has no prior scheduled attempt;
- enabling or retiming a schedule resets its effective time so historical slots are not backfilled unexpectedly;
- if a manual/settings backup operation is busy when a catch-up is due, the missed run is retried rather than discarded;
- scheduled destinations can be existing local directories, mapped drives or writable UNC/NAS paths;
- enabling a schedule and the explicit **Test destination** action perform a real temporary write/fsync/delete probe;
- manual and scheduled backup creation share a single operation lock, preventing overlapping backup snapshots and settings writes;
- restore staging stops the scheduler first and refuses staging while a backup operation is in flight; cancellation re-arms the scheduler;
- schedule status reports next run, running state, last attempt, last success, last error and retention result;
- scheduled retention defaults to 14 and is configurable from 1–365;
- retention runs only after the new scheduled backup has completed archive verification;
- retention eligibility requires an embedded v0.23.0 backup manifest with `backupSource=scheduled` and the same persistent installation UUID;
- manual backups, foreign-installation scheduled backups, non-backup files and unreadable/unrecognized archives are never auto-pruned;
- the newly created backup and the chronologically newest eligible backup are protected even if system-clock movement makes them differ;
- retention deletion failures are recorded but do not invalidate the newly verified backup;
- scheduled destination diagnostics record destination type rather than the full path.

- end-to-end disaster-recovery integration now creates realistic source state, produces a verified portable backup, restores it into a separate fresh data directory, activates it, and reinitializes queue/scheduler/licensing logic from the recovered files;
- integration assertions cover printer definitions, Print Library metadata/content SHA-256/preview bytes, file-material metadata, terminal history, recovery-held unfinished queue jobs, paused production batches, forced bed-clearance for work that may have printed, disabled restored schedules, emulator settings, installation UUID continuity, and normal fail-closed licence verification;
- the recovered queue is started against an online idle fleet fixture and proves recovery-held work cannot auto-dispatch.

Next: final Windows automated/UI/live validation and release-readiness review.

## Implementation order

1. Backup format + archive/checksum helper.
2. Logical snapshot/export service.
3. Manual backup API and tests.
4. Backup/Recovery UI and manual download/save workflow.
5. Restore inspect/validation.
6. Restore staging + startup activation/rollback.
7. Queue recovery-hold semantics/UI.
8. Scheduled local/network backup settings.
9. Retention and status/diagnostics.
10. Full disaster-recovery tests and documentation.

## Non-negotiable safety rules

- Never auto-start restored unfinished jobs.
- Never auto-clear bed-clearance state.
- Never restore over active physical print/control work.
- Never overwrite current state before the complete backup has validated.
- Never include private licence-signing keys.
- Never claim a backup is encrypted when it only has checksums.
- Never delete manual backups as part of scheduled retention.
- Never accept a newer unsupported backup format silently.
