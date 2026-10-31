# Native HTTPS and certificate management

**Status:** Native HTTPS is implemented; secure onboarding is the default.

## Browser ports and initial setup

| Connection | Direct / internal | K3s/MetalLB Service |
| --- | ---: | ---: |
| HTTP | 4242 | 80 |
| HTTPS | 4243 | 443 |

The container exposes both ports from startup. The sample [Kubernetes Deployment and MetalLB Service](../deploy/kubernetes/print-farm-controller.yaml) forwards 80→4242 and 443→4243. Adapt this example to your existing labels, storage volumes, image tag and deployment policies; **do not apply it unchanged over an existing deployment**. The fixed ports never need changing from the GUI. The optional legacy runtime `PORT` override sets the direct HTTP port and its HTTPS partner to the next numeric port for custom Windows/test installations.

HTTPS is provisioned before password entry by default. Open `https://<controller-host>:4243` directly, or `https://<service-host>` through a Service exposing 443. A persistent managed certificate is generated on first secure startup (also when upgrading an HTTP-only installation); verify its SHA-256 fingerprint from the protected startup console through a trusted channel before trusting it. Existing HTTPS identities are retained. Set `PFC_TLS_NAMES` to a comma-separated list of browser DNS names/IPv4 addresses before first secure startup when the external address differs from local interfaces, especially Kubernetes LoadBalancer addresses. Otherwise localhost, the machine hostname and local IPv4 addresses are used. This setting does not rotate an existing identity; use certificate management for later changes. HTTP password entry and HTTP-only mode require the explicit insecure host opt-in `PFC_AUTH_ALLOW_HTTP=1`; unsetting it restores the secure default on restart. Existing direct HTTP bookmarks may need replacing with the HTTPS URL, and clients must establish certificate trust before login. Keep a protected local recovery console available during upgrades.

Navigate to **Farm management → Users & settings → Connection settings**. The page has three ordered sections:

1. **Connection summary** — read-only mode, HTTP/HTTPS ports, redirect state, certificate source, subject, issuer, SANs, issue/expiry, serial and fingerprint, with an administrator-only download of the *public* certificate. No private-key content or path is ever returned in this metadata.
2. **Connection settings** — choose HTTP, controller-managed self-signed HTTPS or external PEM certificate. Enter DNS and IPv4 SANs for managed certificates, or paste the public PEM certificate/chain and matching private PEM key into two separately labelled multiline text areas for external certificates. Ports are not editable. Enter the current administrator password and confirm the action.
3. **Self-signed certificate replacement** — exists **only if the currently saved mode is controller-managed self-signed HTTPS**. An amber Regenerate button requires current administrator password, explicit acknowledgement and browser confirmation. Regeneration uses the saved SANs and does not change the connection mode, ports or queues. Changing the mode selection in an unsaved form must not make this section appear.

### Safely importing external PEM certificates

External certificate configuration **does not use file paths**. Paste the certificate PEM (including any intermediate chain) into **Public certificate (PEM)** and the corresponding *unencrypted PEM private key* into **Private key (PEM)**. The controller validates certificate validity and key matching before activating the identity; invalid pairs do not replace the active certificate. Supplied PEM pairs are staged in the controller's protected persistent `DATA_DIR/tls/identities` directory and selected through `DATA_DIR/tls/current.json`. The mode and nonsecret names are stored in `settings.json`; PEM contents are **not** included in that settings file.

**Private keys must never be sent over HTTP.** Therefore, if the controller is still using HTTP, first select **controller-managed HTTPS**, provide a matching browser hostname/IP, apply, reconnect securely and explicitly trust the self-signed certificate. Only then select **external PEM certificate** and paste its public and private contents. The GUI disables external PEM Apply over HTTP, and the backend rejects external-key configuration from a plaintext connection. HTTP cannot be made safe for private-key transmission simply by checking permissions after receiving the data, so never paste a key on an HTTP page.

Neither existing public PEM material nor private PEM key material is prefilled in the browser on reopening the tab; this prevents exposing sensitive stored material. When the **saved mode is already external PEM**, leave both text areas blank to retain the existing identity, or paste **both** to replace it. Pasting only one field is rejected. After submitting, the browser clears both areas. Protected files on disk still require proper host/container filesystem access restrictions and secure host-level backup; Windows NTFS ACLs are distinct from POSIX `0600` mode flags. Imported PEM private keys are never included in status, diagnostic logs, download endpoints or portable `.pfcbackup` archives. Renew an externally issued certificate through its issuer, then paste the updated pair over HTTPS; it is not eligible for controller-generated self-signed regeneration.

Older candidate installations with external certificate **paths** are still readable at startup, to avoid breaking already-active TLS deployments. The new GUI no longer allows entering paths; replacing such an identity requires pasting a new PEM pair securely.

### HTTPS activation and HTTP behaviour

Once native HTTPS is active, HTTPS serves the authenticated web application on its fixed port. The permanent HTTP listener provides `GET /healthz` (text `ok`; HEAD is also supported) for Docker/Kubernetes probes, redirects allowed GET/HEAD requests to the HTTPS hostname/port when Host matches the active certificate, and rejects HTTP logins and API mutations. An unrecognized Host is not a redirect target. HTTPS session cookies use `Secure`, and authentication/CSRF/Origin checks remain enforced. Self-signed certificates still need explicit client trust; if the certificate is not trusted, browsers can warn or refuse access.

Reapplying unchanged connection settings does **not** regenerate certificates, restart listeners or revoke existing sessions. Connection-mode or certificate updates may briefly disconnect browsers and revoke sessions without stopping printers or queues. Saved settings and identities persist through application restarts when the data volume is retained. Damaged configured TLS material fails startup rather than silently exposing the full application over HTTP. Regenerating a self-signed identity changes its fingerprint and normally requires clients to trust the new public certificate.

The controller's redirect targets the direct HTTPS port (4243) when the incoming browser Host includes 4242, otherwise the default standard external HTTPS port (443). Custom nonstandard external Service ports are not automatically detectable; plan those mappings explicitly. The controller is intended for local/private LAN use, not direct public Internet access.

## Release validation

Check Linux and Windows Node regression suites, actual Chromium browser flow in both themes, imported PEM validation and sensitive-data redaction, successful and failed TLS activation/rollback, certificate replacement, Windows SEA build, Docker health check, container smoke, port mapping and redirection on a real K3s/MetalLB Service, plus user-visible browser trust and print-farm continuity (SSE, queue, uploads and cameras). The feature remains unmerged until those conditions and explicit merge approval are satisfied.
