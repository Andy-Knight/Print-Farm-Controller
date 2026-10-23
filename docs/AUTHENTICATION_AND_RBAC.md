# Controller authentication and RBAC design

**Status:** Native HTTP authentication, backend RBAC routing, self-service password change and administrator user-management UI have been implemented in the **unmerged feature branch / draft PR #131**. **This is not yet production-validated or released.** Security design and requirements remain tracked in [issue #127](https://github.com/Andy-Knight/Print-Farm-Controller/issues/127).

The controller is local-first. It uses Node's HTTP server on port 4242. Existing deployments stay in legacy unauthenticated mode until deliberate local administrator enrollment; `PFC_AUTH_REQUIRED=1` blocks API access pending enrollment. The new branch adds backend role checks before HTTP API routing, followed by [HTTPS via K3s/MetalLB and Ultimate Certificate Manager](https://github.com/Andy-Knight/Print-Farm-Controller/issues/128). A login page without TLS must **not** be advertised as production secure: a LAN observer can capture passwords/session cookies on plain HTTP.

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
| Edit print library, filament definitions, assigned material/nozzle | – | ✓ | ✓ |
| Complete/create/edit maintenance tasks | – | ✓ | ✓ |
| Add/remove/rename printers, configure toolheads/offset calibration | – | – | ✓ |
| Group membership/configuration, pricing/tax policy | – | – | ✓ |
| Manage alert destinations/rules and purge records | – | – | ✓ |
| Create/download backups, inspect/stage/restore backups | – | – | ✓ |
| Cloud integration/OAuth secrets, diagnostics and licensing | – | – | ✓ |
| User/role management and password reset | – | – | ✓ |
| Development simulator management | – | – | ✓ |

A viewer is **read-only**; a request changing alert read/unread flags is a mutation. An operator cannot download backups or diagnostic bundles (they may contain sensitive data), and cannot change role assignments. Administrators cannot access *undefined* API endpoints by privilege alone. Role names and permission strings are identifiers, not an entitlement bypass mechanism.

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
| Queue, production batches, bed clearance | `queue.read` | `queue.manage` |
| Print Library and preview | `library.read` | `library.manage`; costing policy `pricing.manage` |
| Filaments and tool material designation | `filament.read` | `filament.manage` |
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

**Offline administrator bootstrap:** run `node scripts/manage-users.mjs setup` with an interactive local TTY and the persistent controller `DATA_DIR`, or `PrintFarmController.exe --auth-setup` on a packaged Windows installation. No default password, remote bootstrap token, browser-side setup route or automatic administrator account exists. Enrollment writes an activation marker and scrypt-hashed account store under `<DATA_DIR>/security/` and requires controller restart. `node scripts/manage-users.mjs recover` (or `--auth-recover` on Windows executable) is a local confirmation-protected break-glass path to replace all users and retain the previous store locally; stop the controller first.

**HTTP endpoints:** `GET /api/auth/session` gives current session identity, permissions, CSRF value, setup and transport state; `POST /api/auth/login`, `POST /api/auth/logout` and `POST /api/auth/password` are self-service; `GET/POST /api/auth/users` and `PATCH /api/auth/users/:id` are admin-only. User records are redacted of credential digests. Changing a user's role, password or disabled state revokes that user's live sessions and terminates tracked live streams.

**Transport:** `PFC_PUBLIC_ORIGIN=https://<canonical-host>` is required for secure production password login and is matched exactly against browser `Origin`. Session cookies have `HttpOnly`, `SameSite=Strict`, and `Secure` when HTTPS is configured; mutations require a session-derived CSRF header. Arbitrary `X-Forwarded-Proto` and proxy-supplied host information are not trusted. `PFC_AUTH_ALLOW_HTTP=1` is an explicitly insecure local-development opt-out, not a production option. The controller listener remains HTTP behind a TLS proxy; it MUST NOT be reachable by browsers directly on its MetalLB Service in a production deployment.

**Persistence and restore:** Application account state is intentionally excluded from logical `.pfcbackup` archives and retained across logical restore operations. An account-store error must never fall back to anonymous mode when the marker exists. Opaque sessions live only in server RAM and do not persist across restarts. Single-process/single-controller-replica operation remains the supported baseline.

**Open delivery gates:** Real HTTP server integration, browser Preact and no-bundle fallback, native Windows SEA, K3s/container setup/recovery, backup restore/restart, direct port-bypass protection and externally terminated HTTPS are **not yet signed off**. Do not infer production security from the unit-level tests or a green PR workflow. Review coverage of privileged API action payloads and add per-user security audit events before making this mandatory for customers.

## Account and session lifecycle

1. **Bootstrap:** Require a deliberate, local administrative enrollment action before turning on authentication (e.g., a one-use token printed on a protected TTY or created by a privileged local command, never a universal password). Enrollment must be atomic across restarts; the controller cannot silently revert to anonymous control if the account store is lost or unreadable. A documented local recovery command is required.
2. **Password storage:** Use a vetted memory-hard password hash with per-account salt (for example, correctly parameterised `scrypt` on built-in Node 24); persist only versioned salt/parameters/hash, never plaintext. Apply minimum length, cap payloads, throttle failed attempts and avoid identifying valid usernames in errors.
3. **Session handling:** Prefer cryptographically random opaque session tokens with only token digests stored server-side. Cookies are `HttpOnly`, `SameSite=Strict` or justified `Lax`, path-scoped, with `Secure` on HTTPS. Regenerate after login; enforce absolute and idle timeout, logout, disable-user/session revocation, and never store auth tokens in localStorage or query strings.
4. **CSRF and Origin:** Enforce trusted Origin for unsafe methods plus a CSRF token where appropriate; ensure browser SSE and multipart upload workflows use the same authenticated cookie security controls. Do not trust X-Forwarded-* headers unless the proxy is configured as trusted.
5. **First-run and upgrade:** Existing LAN controller installations must not lock out operators after an upgrade. Offer a deliberate security-onboarding/configuration step that requires administrators to set up TLS before entering a production password. Any temporary migration period needs a visible warning and an explicit end-of-migration state.
6. **Persistence and recovery:** `DATA_DIR` remains the source of account identity on Windows SEA, Docker and K3s. A single node/replica is assumed for session/state semantics until concurrency design is explicitly validated. Decide and test whether users are portable across backups; do **not** accidentally restore a security state that re-enables anonymous access.
7. **Audit:** Record user ID, operation type, target, timestamp, success/denial and source context for sensitive mutations, without storing passwords, session cookies, tokens or other secrets. Apply privacy-conscious log retention.

## Quality gates and future hardening

- **Foundation (v0.59.11):** Explicit route-to-permission policy, endpoint coverage regression tests, threat model, RBAC contract and isolated `AccountStore`, `SessionManager` and `LoginAttemptLimiter` primitives with unit coverage. They intentionally leave the production HTTP server untouched and preserve v0.59.10 behavior. No internet-facing identity or session endpoints exist.
- **Core authentication (implemented in draft PR #131; validation pending):** Integrate the tested `AccountStore`, `SessionManager` and `LoginAttemptLimiter` into a locally bootstrapped authentication service; add login/logout/session APIs, cookie issuance, session validation and revocation after role/password changes, trusted proxy/Origin/CSRF checks, safe recovery and end-to-end API tests. Password hashes use Node 24 built-in scrypt, a unique salt and restricted `DATA_DIR/security/users.json` permissions. Sessions are opaque and only stored as digests in RAM, so restarts invalidate them.
- **Enforcement (implemented in draft PR #131; validation pending):** Integrate middleware into the HTTP router *before* `/api/emulator`, `apiRoute`, streaming and downloads; protect static simulator data; add payload-specific policy where actions share a method and URL. Deny unknown routes and test direct forged client requests.
- **User interface (implemented in draft PR #131; visual QA pending):** Login/expired-session state, current identity, role-permitted controls and admin user-management page using the canonical `docs/CONTROLLER_VISUAL_STYLE_GUIDE.md`. Verify Preact and fallback, browser reloads, concurrent clients and access revocation.
- **Transport rollout:** Before production credential entry, publish UCM-backed HTTPS via MetalLB and ingress/reverse proxy. Disable HTTP bypass and validate forwarded headers, secure cookies, SSE, camera, uploads, restore, password resets and all supported client browsers.
- **Release candidate review:** Test Node 24, npm suites, Chromium real-browser regressions, SEA compatibility, container smoke, security integration, documentation policy and backup/restore migration. Version history belongs only in `CHANGELOG.md`. No main merge without explicit approval.

### Open implementation decisions

- Decide whether account security is compulsory at initial release and how existing installations transition; do not ship an insecure login that gives a false sense of security.
- Confirm a reliable local-only bootstrap and recovery path in both Windows SEA and non-root K3s containers.
- Define precise handling of credential recovery, account-store loss, backups and restore interaction (including rollback) before enabling authentication.
- Decide whether viewer financial pricing/cost reports are permitted or require a separate permission.
- Validate the `/api/batch` request body and nested operations for command-specific privileges, especially safety-critical actions.
