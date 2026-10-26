# Native HTTPS and certificate management — implementation plan

**Status:** Initial implementation on `feature/native-https-controller`, pending automated/packaged/browser validation. Native HTTPS, managed/imported certs, admin metadata/download/regeneration and in-process rotation are coded. HTTP redirect, automatic provided-certificate reload, IPv6 SAN generation and final deployment validation remain outstanding.

## Current configuration

Native HTTPS is opt-in. Configure `PFC_HTTPS_MODE=self-signed` and `PFC_HTTPS_NAMES=hostname,192.168.1.100` (comma-separated DNS/IPv4 SANs) to generate a persistent ECDSA P-256 identity at `DATA_DIR/tls`. Without a name setting, only `localhost,127.0.0.1` are included. Do not assume a LAN address is in the certificate. A provided PEM certificate can instead be loaded using `PFC_HTTPS_MODE=provided`, `PFC_HTTPS_CERT_FILE`, and `PFC_HTTPS_KEY_FILE`.

The HTTPS listener replaces HTTP on the existing `PORT` (default 4242); it does not open an additional unauthenticated port. The GUI in **Security & users** shows certificate status, public certificate download and administrator-confirmed self-signed regeneration. Rotation requires the currently signed-in administrator's password and updates the live listener. Existing connections may need to reconnect; self-signed trust must be installed again. Provided certificates are read on startup and require restart for external updates in this first implementation.

Certificate identity is separate from logical `.pfcbackup` data. Protect the data directory/host permissions and keep independent restricted backups of the TLS identity if continuity matters. For Kubernetes, mount `/data` on a durable PVC and configure MetalLB's Service port 443 to forward to the configured controller `PORT` if desired.

**Remaining work before release:** complete automated CI/browser tests, Windows SEA and multi-architecture container smoke, evaluate certificate trust/recovery and TLS-only exposure, test ingress/direct modes, add redirect only if explicitly requested, and improve external certificate hot reload/rotation if necessary. Self-signed identities are not publicly trusted.

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
