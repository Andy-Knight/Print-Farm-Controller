# Resource admission and backup budgets

Limits apply on Windows and in containers. They protect control/monitoring capacity;
they do not change signed licensing or bypass print readiness and recovery holds.
Administrators can tune every setting in the table under **Users & settings →
Resource limits**. Fields show the active value and default in readable count,
MiB/GiB or seconds units. **Save resource limits** persists the draft, and a
restart notice remains until the controller is restarted and the values are active.
The GUI does not restart the controller or interrupt active work. Restart only
after printing and backup/restore work has finished. Reducing a quota does not
delete existing files or immediately terminate connections; new admission uses
the new policy after restart. Tab changes and live telemetry preserve unsaved edits.
**Use default values** prepares an editable draft; save and restart to apply it.
**Reload saved limits** explicitly discards the current draft.

Host administrators can also set the environment variables below before startup. Values
are positive integer counts, bytes or milliseconds; timeout overrides must not
exceed 24 hours. Invalid overrides fail startup when that policy is initialized.
Environment variables take precedence over saved GUI settings and defaults.
Host-managed fields are locked and identify their environment setting; edit the
Windows service/container environment and restart to change those overrides.
GUI changes require an enrolled, signed-in Administrator and normal Origin/CSRF
checks, including when the host has explicitly selected legacy authentication mode.

Settings persist in `<DATA_DIR>/security/resource-limits.json` with private file
permissions. They are installation policy: portable backups do not export them,
and restore activation leaves the target installation's resource policy intact.
Absent settings use defaults; malformed/invalid saved settings stop startup rather
than silently removing protection. A host administrator can repair the file or
move it aside while the controller is stopped to recover the defaults; host
environment overrides still take precedence.

| Environment setting | Default | Meaning |
| --- | --- | --- |
| `PFC_MAX_UPLOADS` | 4 | Simultaneous staged print uploads, including downstream processing |
| `PFC_MAX_UPLOADS_PER_USER` | 2 | Upload reservations per authenticated account |
| `PFC_MAX_STAGED_UPLOAD_BYTES` | 1 GiB | Aggregate reserved print-upload bytes |
| `PFC_MIN_FREE_DISK_BYTES` | 512 MiB | Free-space margin at upload/library/cloud-download admission |
| `PFC_UPLOAD_TIMEOUT_MS` | 600000 | Absolute print-upload body deadline |
| `PFC_UPLOAD_IDLE_TIMEOUT_MS` | 30000 | Maximum print-upload inactivity |
| `PFC_LIBRARY_MAX_BYTES` | 50 GiB | Actual library storage, including metadata and previews |
| `PFC_LIBRARY_MAX_FILES` | 10000 | Library item directories, including damaged retained items |
| `PFC_LIBRARY_MAX_USER_BYTES` | 10 GiB | Logical file bytes owned by an uploading account |
| `PFC_MAX_SESSIONS` | 1000 | Active sessions across the controller |
| `PFC_MAX_SESSIONS_PER_USER` | 20 | Sessions per account |
| `PFC_MAX_STREAMS` | 128 | Combined camera/event connections |
| `PFC_MAX_STREAMS_PER_USER` | 16 | Camera/event connections per account |
| `PFC_MAX_STREAMS_PER_SESSION` | 8 | Camera/event connections per login session |
| `PFC_MAX_STREAMS_PER_IP` | 32 | Camera/event connections per socket source IP |
| `PFC_BACKUP_MAX_EXPANDED_BYTES` | 64 GiB | Aggregate declared ZIP expansion |
| `PFC_BACKUP_MAX_ENTRY_BYTES` | 1 GiB | Uncompressed ZIP entry size |
| `PFC_BACKUP_ARCHIVE_TIMEOUT_MS` | 600000 | Archive verification/processing budget |
| `PFC_BACKUP_ENTRY_TIMEOUT_MS` | 120000 | Maximum duration of an entry read |
| `PFC_CLOUD_OPERATION_TIMEOUT_MS` | 900000 | Shared total deadline across an operation's cloud calls |
| `PFC_CLOUD_HEADER_TIMEOUT_MS` | 30000 | Cloud response-header deadline |
| `PFC_CLOUD_IDLE_TIMEOUT_MS` | 30000 | Cloud response-body inactivity limit |

The existing 512 MiB per-print-file limit remains. Unknown-length print uploads
reserve their full permitted size. Reservations are acquired before disk work and
released after staging cleanup, including failures. A 9 MiB allowance for preview
and metadata is reserved when admitting a new library copy. Quotas are checked
inside the serialized catalog mutation; identical-file deduplication still reuses
existing content. Existing files are never automatically deleted to satisfy a quota.
New API uploads record the account ID as quota owner and original uploader.
The Print Library shows a dedicated **Uploaded by** column (or labelled mobile
card field), with account, **My uploads**, **Unknown / legacy** and **Deleted
accounts** filters and uploader sorting/search. Names reflect current account
records; removed accounts show **Deleted account**. Duplicate uploads retain
the existing original uploader and quota owner.

Each signed-in user sees their file bytes/count against the active allowance.
The top bar shows each signed-in user's file bytes against their active allowance
beside their account name. Administrators use **Reports & finance → Print library**
for a pie chart and account breakdown, including zero-usage, deleted and legacy
ownership. The library page no longer contains the all-account storage table.
Accounting includes retained valid
size/ownership metadata even when an entry is damaged and absent from the normal
list. Previews/metadata count against installation storage, not logical user bytes.

The storage history graph compares measured library disk bytes with the active
`PFC_LIBRARY_MAX_BYTES` limit at each observation. Measurements run at startup,
every five minutes, after upload/deletion/ownership changes and on uncached usage
requests (a shared cache lasts at most 30 seconds). The latest real observation
per UTC hour is retained for up to 366 days, capped at 9000 points, in the separate
`library-storage-history.json` file. New observations stay live in memory; dirty
history is written atomically at most once every five minutes during normal
operation. Unchanged observations within an hour do not trigger writes. A clean
shutdown flushes pending observations; an unexpected stop can lose observations
since the last successful flush (normally up to five minutes). This does not delay
file metadata or quota enforcement. Backups snapshot the live buffer without
forcing an extra disk write. Normal backups/restores preserve this history;
upgrade migrates the old embedded `reporting-history.json` observations before
removing their original field. Older backups migrate embedded history, or restore
an empty history when none existed, rather than retaining target observations.
Gaps longer than
90 minutes are left disconnected; no prior growth is inferred from today's files.
The top bar refreshes after local changes and every minute while visible.

Administrators may select a file and use **Change quota owner** to move its charge
to an enabled account with enough allowance. This requires explicit confirmation,
administrator authorization and Origin/CSRF validation. The original uploader
remains unchanged. The last 100 ownership changes (timestamp, actor and old/new
account IDs) persist atomically with the file and are visible in that dialog.
Deleting a file also deletes its per-file history. Account renaming preserves
ownership; deleting/recreating an account does not reassign its files. Unassigned
entries use installation quota until explicitly assigned. Backups preserve IDs
and history, but restore does not replace target accounts; unmatched source IDs
remain deleted/unmatched until their quota ownership is reassigned. Account
management details and other users' usage totals remain administrator-only.

Free-space checks use the relevant staging/library/backup filesystem. Generated
backups reserve their declared payload plus 32 MiB overhead, capped at the ZIP32
output limit, before writing. This is conservative for highly compressible data. Restore target
checks retain the additional payload/staging margin and run before payload hashing.
Free space can change after admission; write failures still clean up staged files.
Keep persistent data/log volumes separate and provision space for backups, staging
and the operating-system temporary directory as well as the library itself.

Expired sessions are swept before new-session admission and quota accounting;
expired tokens cannot keep occupying login capacity. Close/sign out of unused
sessions to free active capacity. Live streams also default to eight per
session and 32 per socket source IP. Reverse proxies share that source-IP bucket.
Explicit legacy mode shares account/session capacity by source IP. Closed or failed
streams release all counters; ordinary health/status requests are not stream slots.

File inspection runs at most two jobs with at most 16 waiting jobs. 3MF requirements
use bounded ZIP-directory/range reads and a maximum 16 MiB embedded plate, parsing
only the head/tail metadata window. Previews use asynchronous decompression, bounded
output/candidate counts and a bounded G-code line scan. Unsupported or oversized
inspection retains the existing unavailable-metadata/preview behavior and cannot
invent automatic print compatibility.

Backup ZIP directories are limited to 16 MiB and 50000 entries before allocation.
Declared per-entry/aggregate expansion and checksum sizes are checked before
payload verification. Actual reads enforce declared sizes, CRCs, SHA-256 checksums,
an aggregate output-work budget and deadlines, and close upstream readers on error.
Checksums do not encrypt or authenticate an intentionally rewritten backup; backup
encryption remains separate work. ZIP32 and existing restore upload limits remain.

Google Drive, OneDrive and S3 share operation budgets through authentication,
pagination, transfers and cleanup. Metadata/error bodies are limited to 4 MiB per
response and 16 MiB per operation; listing work is capped at 100 pages/10000 items.
Streaming backup bodies retain the existing maximum 4 GiB restore size. No new
automatic retries are added; existing refresh/retry behavior shares the same total
budget. Destination validation and credential-safe redirect rules still apply.

An authenticated Administrator can cancel active backup/restore work using
`POST /api/backup/cancel` with the normal same-origin and CSRF headers. It returns
the number of active operation contexts signalled for cancellation. Cancellation
closes fetch/upload/download streams, aborts archive work, removes partial staging
and releases locks after cleanup. Already committed remote files are not implicitly
deleted, and this does not undo a completed restore stage or activate a restore.
Use the existing staged-restore cancellation for an already completed stage.
Cancellation is available through the API; no new browser button is added.

Excess upload/session/stream admission returns HTTP 429; inspection saturation uses
503 and storage/free-space quota failures use 507. Deadline/cancellation failures
report an operation error or close an interrupted streaming response. Other control
and health routes remain available when these capacities are exhausted. Tune host
limits deliberately for slower links and larger installations; clients cannot raise
them through request parameters.

The administrator API uses `GET /api/settings/resource-limits` for active/saved
values, units, defaults, host-lock status and restart status. `PUT` on the same
path accepts `{ "overrides": { "PFC_MAX_UPLOADS": 4 } }` in base units (counts,
bytes, milliseconds), replacing saved unlocked overrides. Omitted unlocked keys
return to defaults. Host-managed keys cannot be written; their dormant saved
values are retained. Writes never change active process policy before restart.
The GUI lists fixed file-format, parser, cloud listing/response and inspection
concurrency limits as read-only processing safeguards.
