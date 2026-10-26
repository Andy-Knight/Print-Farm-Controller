# Native HTTPS and certificate management — implementation plan

**Status:** The HTTP-first / GUI-configured native HTTPS implementation is on `feature/native-https-controller`, under draft PR review. Runtime, browser, Windows SEA and container test gates are required before merging. Native HTTPS, managed and supplied PEM identities, protected certificate regeneration, and in-process browser-listener switching are implemented in the feature branch. No second HTTP listener or automatic HTTP-to-HTTPS redirect exists.

## Setup and controller lifecycle

1. **Initial HTTP access:** A new installation with no persistent TLS settings listens on `http://<controller-ip>:4242` by default. Create or sign into an administrator account. Initial credentials are exposed to LAN interception until HTTPS is enabled: use localhost or a trusted/isolated setup network.
2. **GUI configuration:** Open **Farm management → Security & users → HTTPS & certificates tab → Connection settings**; the separate **Users** tab manages accounts. Select HTTP, managed self-signed HTTPS or externally supplied HTTPS, enter the port and the matching browser DNS/IPv4 names (managed) or absolute server-side PEM certificate/key file paths (supplied), and confirm with the administrator password and an explicit acknowledgement. No `PFC_HTTPS_*` environment variables or separate certificate-generation tools are needed.
3. **Apply:** The controller validates certificate SANs, key match and validity, stages a candidate and responds with a reconnect address. It then closes/replaces its HTTP(S) listener in the same process, preserving print queue and printer services. Existing browser sessions are revoked whenever protocol changes. Reconnect using HTTPS and sign in again. When reusing port 4242, it is no longer accessible as HTTP.
4. **Persistence:** Non-secret settings are stored in `DATA_DIR/tls/settings.json`. Generated key/cert pairs and their selection pointer live in the protected `DATA_DIR/tls/identities` directory and `current.json`. Mode and port survive restarts. A damaged configured HTTPS certificate must fail startup rather than silently expose an HTTP fallback.
5. **Manage:** The two controller-standard underline tabs on Security & users are **Users** and **HTTPS & certificates**, with accessible keyboard arrows, Home/End and a single active panel. Administrators can inspect fingerprint, issuer, validity, DNS/IP SANs and download the public certificate. **Apply connection settings is a no-op when all settings are unchanged** and never replaces the current key or certificate in that case. An amber **Regenerate self-signed certificate** action is available only when the *saved* mode is controller-managed HTTPS; choosing it requires the administrator's current password, acknowledgment and final browser confirmation. Explicit regeneration creates a new key/cert with the *currently configured SANs*, activates it on the existing HTTPS listener and may require browser clients to re-trust it. Supplied certificate files are never overwritten; update the external files and restart the controller to reload them.

**GUI field guidance:** The HTTPS listening port defaults to 4242. MetalLB may expose Service port 443 and forward to 4242 without changing the controller listener port. Explicitly permit a different HTTPS port in firewall/Service configuration before applying. For provided mode, PEM paths must exist **on the controller host/container**, not just on the administrator's desktop. Mount UCM/Kubernetes TLS Secrets read-only. The private key is neither uploaded from the browser nor returned in metadata. Self-signed certificates encrypt traffic but are not automatically trusted; verify fingerprint via a trusted channel and install their public certificate separately.

**File permissions:** On POSIX hosts, managed key files are created with mode `0600` and identity directories with `0700`; automated tests assert these permissions. On **Windows**, Node.js POSIX mode bits are not equivalent to NTFS ACLs and `fs.stat().mode` may report `0666` for files created with `0600`. Place the controller data directory on an NTFS path whose ACL restricts access to the controller's service/user account and authorized administrators; do not treat a `0600` Node.js creation flag as proof of Windows ACL protection. Automated Windows ACL verification and hardening remain release-validation tasks.

**Transport and recovery:** No HTTP redirect or additional insecure listener is opened when native HTTPS is enabled. The controller is LAN-only, not Internet-hardened. Session cookies become Secure on HTTPS and CSRF/Origin checks follow the effective listener. Incomplete activation or failure to bind a new port attempts to restore the previous working transport and persistent configuration; operators should confirm reconnect and status. To recover an unusable TLS identity, stop the controller and restore/reconfigure the protected TLS files through privileged local access; do not delete accounts or disable RBAC. Logical `.pfcbackup` archives deliberately exclude TLS identity files. For optional external proxy termination, use the existing restricted-backend proxy model documented in the README.

**Outstanding release gates:** automated failure injection including an actual bind conflict, browser Preact/fallback, Windows SEA, container/K3s/MetalLB live smoke, certificate-trust UX, bad-certificate recovery and TLS handoff with SSE/cameras/uploads. IPv6 SAN generation, automatic provided-certificate hot reload and HTTP redirect are not part of this first change.


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
