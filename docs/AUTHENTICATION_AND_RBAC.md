# Controller authentication and RBAC design

**Status:** Native HTTP authentication, backend RBAC routing, self-service password change and administrator user-management UI have been implemented in the **unmerged feature branch / draft PR #131**. **This is not yet production-validated or released.** Security design and requirements remain tracked in [issue #127](https://github.com/Andy-Knight/Print-Farm-Controller/issues/127).

The controller is local-first. It uses Node's HTTP server on port 4242. Authentication and backend RBAC are enabled by default for HTTP and HTTPS deployments. Before administrator enrollment, the Security & users GUI is the only operational path and the server blocks printer APIs; the owner verifies a private startup-log code to enroll. `PFC_AUTH_REQUIRED=0` is an explicit unsafe pre-enrollment opt-out overridden by a durable account store or activation marker. The new branch adds backend role checks before HTTP API routing, followed by [HTTPS via K3s/MetalLB and Ultimate Certificate Manager](https://github.com/Andy-Knight/Print-Farm-Controller/issues/128). A login page without TLS must **not** be advertised as production secure: a LAN observer can capture passwords/session cookies on plain HTTP.

## Trust boundaries and threat model

| Boundary | Threat | Control / requirement |
| --- | --- | --- |
| Browser or crafted HTTP client → controller | Unauthenticated printer start, cancel, heaters, file deletion, settings and restore | Authenticate request before every protected route, including command entry points. Deny by default, respond 401/403. UI hiding is not enforcement. |
| Browser → controller over LAN | Intercepted credentials, hijacked sessions, manipulated commands | Require trusted HTTPS for production password entry and secure cookies. TLS termination may be at MetalLB-backed ingress; prevent direct HTTP bypass. |
| Different browsers/users | One user performing another's privileged action | Session-bound server-side identity; per-request permission checks, role changes revoke sessions. |
| Malicious website opened in a logged-in browser | Cross-site printer/backup requests | SameSite cookies, Origin/CSRF enforcement for all mutating endpoints, never treat GET as a state change. |
| Login / recovery | Brute force, default passwords, locked-out site | Rate limits, constant-time credential checks, secure hash with individual salt, operator-controlled one-use admin bootstrap, local recovery procedure. |
| Backend SSE and cameras | Unauthenticated read of fleet/status/camera and retained stream after revocation | Authenticate BEFORE opening long-lived streams and close streams on expiry/revocation. Same policy as status API. |
| Credentials, backups and diagnostics | Access to tokens, archives, private configuration | Administrator-only cloud integration, diagnostics, restore and licence operations; secrets never returned to viewer/operator. |
| Reverse proxy / Host headers | Spoofed X-Forwarded-Proto/Host or CSRF bypass | Explicit trusted proxy configuration. Reject arbitrary forwarded headers; validate request Origin against the externally configured canonical origin. |
| Auth data at rest and deployment migration | Lost or leaked admin keys, rollback to unauthenticated behavior | Restrictive `<DATA_DIR>/security` permissions, deterministic recovery, backup/restore rules; upgrade existing deployments without surprise lockout or silent fallback. |
| Licensing and printer adapters | Confusion between product edition, printer entitlement and operator authorization | Separate signed edition enforcement from user permissions. Backend still performs physical operation/preflight checks. |

## Roles and permissions

Source of the proposed RBAC policy: `src/security/authorization-policy.js`; policy tests: `test/authorization-policy.test.js`. These are invoked before controller/emulator HTTP API routing when authentication is enabled in this feature branch; release validation remains outstanding.

| Permission | Viewer | Operator | Administrator |
| --- | :---: | :---: | :---: |
| Dashboard, fleet, status and current printer data | ✓ | ✓ | ✓ |
| Read queues, library previews, filament catalogue and reports | ✓ | ✓ | ✓ |
| Camera streams and SSE live fleet updates | ✓ | ✓ | ✓ |
| Start/pause/resume/cancel prints, bed clearance, fans/temperatures | – | ✓ | ✓ |
| Upload/delete printer files, create/reorder/cancel queue work | – | ✓ | ✓ |
| Purge completed/failed/cancelled queue history | – | – | ✓ |
| Add/edit Print Library files, including metadata and favourites | – | ✓ | ✓ |
| Permanently delete Print Library files | – | – | ✓ |
| Assign filament type/colour and nozzle designations to printers | – | ✓ | ✓ |
| Create, edit or delete central filament catalogue entries/prices | – | – | ✓ |
| Complete/create/edit maintenance tasks | – | ✓ | ✓ |
| Add/remove/rename printers, configure toolheads/offset calibration | – | – | ✓ |
| Group membership/configuration, pricing/tax policy | – | – | ✓ |
| Manage alert destinations/rules and purge records | – | – | ✓ |
| Create/download backups, inspect/stage/restore backups | – | – | ✓ |
| Cloud integration/OAuth secrets, diagnostics and licensing | – | – | ✓ |
| User/role management and password reset | – | – | ✓ |
| Development simulator management | – | – | ✓ |

A viewer is **read-only**; a request changing alert read/unread flags is a mutation. An operator cannot purge queue history, permanently delete stored Print Library files, or edit the shared filament cost catalogue; operators retain queue cancellation and printer-level filament/nozzle assignment. They also cannot download backups or diagnostic bundles (which may contain sensitive data), or change role assignments. Administrators cannot access *undefined* API endpoints by privilege alone. Role names and permission strings are identifiers, not an entitlement bypass mechanism.

A later review must map **individual `/api/batch` and `/api/printers/:id/*` command payloads**, not just their HTTP route: if a single endpoint dispatches different action classes, authorize each supported action. Existing licence and printer-operation safety checks still apply afterwards. Consider narrowly scoped custom roles only once the three-role baseline is validated.

## Endpoint families to guard

| Family | Read permission | Mutation permission |
| --- | --- | --- |
| `/api/health` | Public liveness only; remove licence/fleet metadata before activation | No write |
| `/api/events`, `/api/fleet`, printer status | `printer.read` | No write |
| Camera proxy/snapshot | `camera.read` | Camera operations `printer.operate` |
| Printer registry and tool configuration | `printer.read` | `printer.configure` (admin) |
| Print controls, `/api/batch`, `/api/distribute` | Relevant read routes | `printer.operate` / `queue.manage` |
| Printer files | `printer.read` | `printer.files.manage` |
| Queue, production batches, bed clearance | `queue.read` | `queue.manage`; destructive history purge `queue.history.purge` (Administrator) |
| Print Library and preview | `library.read` | `library.manage` (add/edit); `library.delete` (Administrator); costing policy `pricing.manage` |
| Filament catalogue and printer-level designation | `filament.read` | `filament.assign` (printer assignment); `filament.manage` (Administrator catalogue changes) |
| Printer Groups | `group.read` | `group.manage` |
| Maintenance | `maintenance.read` | `maintenance.manage`; destructive history purge `maintenance.purge` |
| Analytics/reports | `report.read` | No write |
| Alerts/history | `alert.read` | `alert.acknowledge` / `alert.manage` |
| Scheduled backups / downloads | Admin `backup.manage` | Admin `backup.manage` |
| Cloud restore / upload and staging | Admin `restore.manage` | Admin `restore.manage` |
| Google Drive, OneDrive, S3 accounts | Admin `integration.manage` | Admin `integration.manage` |
| Diagnostics, diagnostic bundles | Admin `diagnostics.manage` | Admin `diagnostics.manage` |
| License / signed licence installation | `system.read` | Admin `license.manage` |
| Simulator API | Admin `simulator.manage` | Admin `simulator.manage` |
| Authentication/management routes (to be implemented) | Self profile / admin users | Admin `user.manage`; self logout/password |

**Unknown method/path combination:** deny by default in authorization, then return an appropriate 404/405 after authentication; do not infer access from `GET`, a path prefix, a URL extension, or hidden UI controls. Public static assets are a separate routing concern. The simulator's static workspace also requires review for data exposure.

## Implemented authentication candidate (draft PR #131)

The controller uses `src/security/http-auth.js` as a central gate ahead of the emulator API, ordinary controller APIs, sensitive downloads, SSE and camera routes. Unknown API routes fail closed. Static frontend assets remain public so an unauthenticated browser can display the sign-in shell. The simulator's static UI is admin-only. `GET /api/health` gives minimal liveness without licence or fleet metadata once protection is enabled.

**GUI first-administrator bootstrap:** Before any account exists the controller generates a random 192-bit one-time code printed only in the protected startup console/pod logs, **before diagnostic logging begins**. The owner opens **Security & users** in the browser and enters the code and initial administrator credentials. HTTPS is available before enrollment by default; plaintext operation requires explicit host opt-in. Kubernetes users can view pod logs using a cluster management GUI; the controller never exposes the code via HTTP or diagnostic downloads. Code checks use timing-safe comparison, Origin validation and per-source throttling. A successful setup immediately enables durable authentication and invalidates the code. An unused code rotates on restart. No default password, open self-registration, or first-visitor administrator takeover is permitted. If an account store is missing after the activation marker exists, browser re-enrollment is forbidden. Local privileged CLI `setup` remains an alternative for headless use; `recover` remains a deliberate offline break-glass procedure requiring the controller to be stopped.

**HTTP endpoints:** `GET /api/auth/session` gives current session identity, permissions, CSRF value, enrollment availability and transport state; `POST /api/auth/enroll` performs first-administrator enrollment with a code and trusted Origin (never a recovery path); `POST /api/auth/login`, `POST /api/auth/logout` and `POST /api/auth/password` are self-service; `GET/POST /api/auth/users` and `PATCH /api/auth/users/:id` are admin-only. User records are redacted of credential digests. Changing a user's role, password or disabled state revokes that user's live sessions and terminates tracked live streams.

**Transport:** HTTPS enrollment/login are the default. Plaintext mode requires `PFC_AUTH_ALLOW_HTTP=1`; otherwise startup provisions managed HTTPS if no identity is active. Secure cookies, Origin and CSRF checks remain mandatory. See the secure-onboarding section below for trust, external SANs and migration.

**Persistence and restore:** Application account state is intentionally excluded from logical `.pfcbackup` archives and retained across logical restore operations. An account-store error must never fall back to anonymous mode when the marker exists. Opaque sessions live only in server RAM and do not persist across restarts. Passive reads, SSE and identity polling do not renew the idle timeout; actual trusted user pointer/keyboard interaction is reported through the CSRF-protected `POST /api/auth/activity` endpoint, and authorized state-changing operations also renew idle sessions. Single-process/single-controller-replica operation remains the supported baseline.

**Open delivery gates:** Real HTTP server integration, browser Preact and no-bundle fallback, native Windows SEA, K3s/container setup/recovery, backup restore/restart, direct port-bypass protection and externally terminated HTTPS are **not yet signed off**. Do not infer production security from the unit-level tests or a green PR workflow. Review coverage of privileged API action payloads and add per-user security audit events before making this mandatory for customers.

## Account and session lifecycle

1. **Bootstrap:** Require a private one-time code retrieved from protected startup logs and entered through the browser, never first-visitor registration or a universal password. Enrollment must remain atomic and fail closed across restarts; a lost account store must not silently restore anonymous access. The offline recovery path must remain separate.
2. **Password storage:** Use a vetted memory-hard password hash with per-account salt (for example, correctly parameterised `scrypt` on built-in Node 24); persist only versioned salt/parameters/hash, never plaintext. Apply minimum length, cap payloads, throttle failed attempts and avoid identifying valid usernames in errors.
3. **Session handling:** Prefer cryptographically random opaque session tokens with only token digests stored server-side. Cookies are `HttpOnly`, `SameSite=Strict` or justified `Lax`, path-scoped, with `Secure` on HTTPS. Regenerate after login; enforce absolute and idle timeout, logout, disable-user/session revocation, and never store auth tokens in localStorage or query strings.
4. **CSRF and Origin:** Enforce trusted Origin for unsafe methods plus a CSRF token where appropriate; ensure browser SSE and multipart upload workflows use the same authenticated cookie security controls. Do not trust X-Forwarded-* headers unless the proxy is configured as trusted.
5. **First-run and upgrade:** Default-on authentication blocks printer operations until a private-code-verified administrator is enrolled. HTTP sign-in requires `PFC_AUTH_ALLOW_HTTP=1` and must show a visible interception warning. `PFC_AUTH_REQUIRED=0` temporarily opts into unsafe legacy mode if no administrator has ever been enrolled.
6. **Persistence and recovery:** `DATA_DIR` remains the source of account identity on Windows SEA, Docker and K3s. A single node/replica is assumed for session/state semantics until concurrency design is explicitly validated. Decide and test whether users are portable across backups; do **not** accidentally restore a security state that re-enables anonymous access.
7. **Audit:** Record user ID, operation type, target, timestamp, success/denial and source context for sensitive mutations, without storing passwords, session cookies, tokens or other secrets. Apply privacy-conscious log retention.

## Quality gates and future hardening

Browser user-management checks must wait for the role-save PATCH and subsequent
user-list GET, verify the persisted role in that response, and wait for the
refreshed row before testing its actions. Selecting a dropdown changes its draft
value immediately; it does not prove the save finished. The list temporarily
shows a loading message during refresh, so checking Delete before that refresh
completes can report a false permission failure.

- **Foundation (v0.59.11):** Explicit route-to-permission policy, endpoint coverage regression tests, threat model, RBAC contract and isolated `AccountStore`, `SessionManager` and `LoginAttemptLimiter` primitives with unit coverage. They intentionally leave the production HTTP server untouched and preserve v0.59.10 behavior. No internet-facing identity or session endpoints exist.
- **Core authentication (implemented in draft PR #131; validation pending):** Integrate the tested `AccountStore`, `SessionManager` and `LoginAttemptLimiter` into a locally bootstrapped authentication service; add login/logout/session APIs, cookie issuance, session validation and revocation after role/password changes, trusted proxy/Origin/CSRF checks, safe recovery and end-to-end API tests. Password hashes use Node 24 built-in scrypt, a unique salt and restricted `DATA_DIR/security/users.json` permissions. Sessions are opaque and only stored as digests in RAM, so restarts invalidate them.
- **Enforcement (implemented in draft PR #131; validation pending):** Integrate middleware into the HTTP router *before* `/api/emulator`, `apiRoute`, streaming and downloads; protect static simulator data; add payload-specific policy where actions share a method and URL. Deny unknown routes and test direct forged client requests.
- **User interface (implemented in draft PR #131; visual QA pending):** Security & users setup flow, login/expired-session state, current identity, role-permitted controls and admin user-management page using the canonical `docs/CONTROLLER_VISUAL_STYLE_GUIDE.md`. Verify Preact and fallback, browser reloads, concurrent clients and access revocation.
- **Transport rollout:** Before production credential entry, publish UCM-backed HTTPS via MetalLB and ingress/reverse proxy. Disable HTTP bypass and validate forwarded headers, secure cookies, SSE, camera, uploads, restore, password resets and all supported client browsers.
- **Release candidate review:** Test Node 24, npm suites, Chromium real-browser regressions, SEA compatibility, container smoke, security integration, documentation policy and backup/restore migration. Version history belongs only in `CHANGELOG.md`. No main merge without explicit approval.

### Open implementation decisions

- Decide whether account security is compulsory at initial release and how existing installations transition; do not ship an insecure login that gives a false sense of security.
- Validate GUI enrollment using private startup log codes, and retain reliable offline recovery on Windows SEA and non-root K3s containers.
- Define precise handling of credential recovery, account-store loss, backups and restore interaction (including rollback) before enabling authentication.
- Decide whether viewer financial pricing/cost reports are permitted or require a separate permission.
- Validate the `/api/batch` request body and nested operations for command-specific privileges, especially safety-critical actions.

## Secure onboarding and notification confidentiality

HTTPS is provisioned before password entry by default. Open `https://<controller-host>:4243` directly, or `https://<service-host>` through a Service exposing 443. A persistent managed certificate is generated on first secure startup (also when upgrading an HTTP-only installation); verify its SHA-256 fingerprint from the protected startup console through a trusted channel before trusting it. Existing HTTPS identities are retained. Set `PFC_TLS_NAMES` to a comma-separated list of browser DNS names/IPv4 addresses before first secure startup when the external address differs from local interfaces, especially Kubernetes LoadBalancer addresses. Otherwise localhost, the machine hostname and local IPv4 addresses are used. This setting does not rotate an existing identity; use certificate management for later changes. HTTP password entry and HTTP-only mode require the explicit insecure host opt-in `PFC_AUTH_ALLOW_HTTP=1`; unsetting it restores the secure default on restart. Existing direct HTTP bookmarks may need replacing with the HTTPS URL, and clients must establish certificate trust before login. Keep a protected local recovery console available during upgrades.

Alert history remains readable to authorized monitoring roles. Only administrators receive notification destination configuration, including URLs, server names and topics.
