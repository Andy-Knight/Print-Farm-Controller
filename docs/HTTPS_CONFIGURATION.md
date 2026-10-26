# Native HTTPS and certificate management — implementation plan

**Status:** GUI-configured native HTTPS with two fixed internal listeners is in development on `feature/native-https-controller` (draft PR #136). Do not merge until runtime, browser, Windows SEA, container, and K3s/MetalLB deployment checks succeed.

## Fixed-port transport and initial setup

- **Internal ports:** HTTP **4242**, HTTPS **4243**. Node's legacy `PORT` override continues to set the HTTP port in direct/custom installations; HTTPS uses its immediately succeeding port. Administrators cannot change either from the GUI.
- **Kubernetes/MetalLB:** Use the sample [Deployment and LoadBalancer Service](../deploy/kubernetes/print-farm-controller.yaml), exposing external **80→4242** and **443→4243**. Both container ports are fixed and declared at startup. Retain persistent separate `/data` and `/logs` volumes, a single controller replica, and existing storage/access policies. Do not apply the example unchanged over an existing deployment; adapt names, selectors, storage and image tag. No ingress or reverse proxy is needed.
- **Direct/Windows:** Before HTTPS, browse to `http://<controller-host>:4242`. Afterwards, browse to `https://<controller-host>:4243`. With the standard MetalLB Service, omit ports from the URLs.
- **Initial setup:** On localhost or an isolated trusted LAN, enroll/login with the protected one-time startup-log administrator code, then select **Security & users → HTTPS & certificates**. HTTP credentials are transmitted in plaintext until HTTPS is enabled.
- **GUI:** Select HTTP only, controller-managed self-signed HTTPS (validated DNS and IPv4 SAN names), or externally supplied PEM key/certificate (absolute paths inside the host/container). Current admin password, explicit acknowledgement and browser confirmation protect changes. Ports are read-only and the page explains both direct and standard external mappings.

## HTTP, HTTPS and health endpoints

The HTTP listener **always** remains on 4242. Before HTTPS is enabled, it serves normal authenticated controller functionality. Once HTTPS is active, it serves a minimal public `GET /healthz` (text `ok`; also HEAD), redirects GET/HEAD browser requests to HTTPS with **302 no-store** when the Host matches the active certificate, and rejects all other HTTP requests with 403; mismatched Host requests receive 421. No login or API mutation can be performed on HTTP. This also prevents silent downgrade via the plaintext port. The HTTPS listener on 4243 serves the complete controller app and API using secure cookies and native CSRF/Origin controls. No fixed-port change or pod restart is required when switching the saved HTTPS mode.

Docker HEALTHCHECK and Kubernetes readiness/liveness probes use `http://127.0.0.1:4242/healthz` (or the named HTTP container port). They do **not** depend on the certificate being valid or trusted, and they reveal no printer/account state. The controller must still fail startup when a previously configured identity is invalid: the health endpoint is not an alternate access route or a mechanism to bypass TLS.

The redirect chooses the direct secure port when the Host header advertises the fixed direct HTTP port (e.g. `:4242`), and otherwise targets the standard external HTTPS port **443**. Nonstandard externally mapped Service ports cannot be inferred by the controller and should be documented as a custom deployment exception. Redirect target hostnames must match the installed certificate SAN/hostname verification and untrusted Host values are rejected. No hardcoded redirect IP is required; MetalLB supplies the browser-reachable IP. The controller does not dynamically configure Kubernetes Services or firewall rules.

## Certificate lifecycle and persistence

The TLS settings file `DATA_DIR/tls/settings.json` contains mode, SAN names and optionally supplied paths, **not an editable port**. Previously saved candidate settings with a custom listener port are interpreted using the new fixed ports on startup, preserving the existing managed certificate identity and its fingerprint; operators using older candidate URLs must reconnect to the new address. Key/cert files are stored in protected `DATA_DIR/tls/identities` with `current.json` pointing to the selected identity. Invalid saved identities fail closed rather than silently enabling unprotected HTTP.

Applying unchanged configuration is a no-op and does not reissue certificates. Changing SANs or the selected certificate source can update the live TLS context without changing ports. A separately exposed amber **Regenerate self-signed certificate** action appears only when the saved mode is managed; it requires administrator reauthentication, confirmation and new key generation, and does not change SANs or ports. Externally supplied certificates are read from mounted/readable PEM files, never copied or overwritten, and reload on a controller restart. Only the **public** certificate is downloadable; protect `/data/tls`, use host-level backups for TLS identity and note that logical `.pfcbackup` exports omit private TLS keys. Clients must explicitly trust self-signed identities after verifying the fingerprint, including following regeneration.

On POSIX, managed identity directories are mode 0700 and private-key files mode 0600. On Windows, these mode bits do not imply NTFS ACL protections; restrict the controller data directory through Windows ACLs. Windows ACL hardening/verification remains a release gate.

## Validation before merge

Test container Dockerfile health checks after HTTPS activation, MetalLB 80/443 routing, direct Windows ports, HTTP redirect-only semantics, rejected HTTP mutations and mismatched Host, persistent TLS across restarts, bad-certificate failure, certificate rotation and browser re-trust, SSE/cameras/uploads/queuing, Preact and legacy fallback, and document-policy/Windows SEA/container smoke gates. IPv6 SAN generation, browser automatic trust and hot reload of external PEM files are outside this initial feature.

## Objective and deployment modes

Enable browser-to-controller HTTPS directly in the Node.js application on both Windows and containers, without requiring Kubernetes ingress or a reverse proxy. Keep TLS for the browser/controller interface separate from printer-adapter communications and preserve existing authentication/RBAC rules.

Support two certificate sources:

1. **Controller-managed self-signed certificate:** generated locally for the controller and persisted across restarts, upgrades and container recreations when the data volume is retained. An administrator may explicitly **regenerate** it from the controller web interface.
2. **Administrator-supplied certificate and private key:** imported or mounted from an external provider such as Ultimate Certificate Manager (UCM). These are external lifecycle assets; never overwrite or regenerate them when the user requests self-signed renewal. Externally managed certificate rotation should support safe reload when possible.

A TLS proxy/ingress remains a supported, *optional* deployment architecture. Issue #128 documents the separate ingress approach; native HTTPS must not require it.

## Administrator interface

Use the existing **Security & users** administrator area, with a dedicated **HTTPS & certificates** section (or tab if that fits the existing page architecture). Follow `docs/CONTROLLER_VISUAL_STYLE_GUIDE.md`, including responsive layout, accessible form/button controls, both themes, and Preact/fallback parity.

The page should make the following visible:

- HTTPS mode: disabled/HTTP, controller-managed self-signed, or externally supplied certificate.
- Active certificate status and source; common name, DNS and IP subject-alternative names, serial or SHA-256 fingerprint, issue date, expiry date, and renewal/expiry warnings.
- Configured HTTPS port, the advertised URL, and whether HTTP-to-HTTPS redirect is enabled, with warnings if another endpoint bypasses HTTPS.
- **Regenerate self-signed certificate** action available only to authenticated administrators while controller-managed mode is selected. The button is unavailable for a mounted/imported certificate.
- A way to download the **public certificate only** and clear guidance for installing trust on Windows, macOS and mobile clients. Never expose/download the private key from the browser.
- A concise warning: self-signed encryption protects transport but **does not provide automatic browser trust**. Regeneration changes the certificate identity and may require clients to re-trust it; browser warnings cannot be suppressed by the controller.

### Regeneration user flow

1. Administrator selects **Regenerate self-signed certificate**.
2. Show a confirmation dialog explaining that active browser connections/streams may reconnect and certificate trust may need updating on every client. Require recent administrator re-authentication or equivalent sensitive-operation confirmation; a hidden/disabled UI button alone is not authorization.
3. Generate a **new key pair and certificate**, using validated configured DNS names and IP addresses as subject-alternative names. Do not reuse the existing key or silently carry over obsolete hostnames.
4. Validate certificate/private-key match, SANs, validity and file permissions *before* activation; stage files and make the swap atomic with rollback on write/reload failure. Never leave the listener referencing half-written key material.
5. Switch the TLS listener to the new identity safely (in-process secure-context reload if feasible; otherwise an explicit controlled restart), report the actual outcome and new fingerprint, and preserve the previous working identity if activation fails.
6. Explain that the current browser might disconnect or challenge the new certificate and how to reconnect/trust it. Do not claim that the browser will automatically trust the regenerated identity.

Certificate regeneration must not change accounts, roles, passwords, revocable sessions, licensing, printer configuration or print queues.

## Backend and security requirements

- All certificate-management endpoints are **administrator-only** and protected by the existing backend permission checks, CSRF and trusted-Origin validation. Reject spoofed requests and log administrative actions without logging private key material.
- Keys are generated with cryptographically secure randomness and strong maintained algorithms. Review any certificate-signing library against `docs/dependency-security.md`; do **not** assume an OpenSSL executable is installed on Windows or inside the released container.
- Keep key and certificate files outside `public/` and other web-served paths, in a restricted persistent TLS directory (typically under `DATA_DIR`, which maps to `/data` in a container). Apply appropriate POSIX permissions and Windows ACL safeguards; never store private keys in the repository, logs or API responses.
- Keep TLS private keys out of **portable logical `.pfcbackup`** archives by default; a backup restore must not silently replace the active controller identity. Document operating-system-level TLS recovery separately.
- Validate imported certificates and their private keys before activation; report errors without exposing secrets. Self-signed regeneration must never overwrite an externally supplied certificate.
- Define canonical origin and HTTPS detection consistently for login, secure cookies, session management, CSRF, SSE, camera proxying, uploads/downloads and redirect. Do not trust arbitrary `X-Forwarded-*` headers. Block/bind or redirect unsecured direct HTTP access according to explicit deployment settings.
- Preserve a recoverable local administrative path if certificate files are corrupt or an expired/mismatched certificate prevents normal web access. Avoid silently falling back to anonymous or insecure administrator access.
- For clients connecting by IP address, the certificate must contain the IP as an **IP SAN** (not merely as a DNS SAN); hostnames require DNS SANs. An IP/hostname change needs an explicit regeneration or certificate replacement.

## Acceptance tests

- Windows packaged SEA and container/K3s/MetalLB startup with a durable managed self-signed identity; restart does not change the fingerprint.
- Administrator-only certificate metadata and rotation APIs: Viewer, Operator, anonymous, forged Origin/CSRF, expired sessions and invalid confirmation are rejected.
- Regeneration changes key, cert and fingerprint; includes correct DNS/IP SANs; remains valid after restart; failure injection leaves the old working certificate active.
- Imported/UCM certificates work but the UI disallows regeneration of those assets.
- Chrome login/logout, Secure cookies, access checks, SSE, camera streams, file uploads/downloads, queues, backups and other important HTTP routes work across HTTPS and cert rotation where applicable.
- Browser trust/warnings, invalid/expired cert, redirect and direct-HTTP bypass scenarios are exercised; instructions do not claim a self-signed certificate is publicly trusted.
- UI and screen-reader/keyboard checks in both Preact and fallback modes; regression tests and required release gates before merge.

**Documentation ownership:** this file owns the feature-level implementation/operations plan; `PROJECT_CONTEXT.md` owns the current task and active risk, `README.md` will describe functionality when implemented, and `CHANGELOG.md` alone will record the eventual release.
