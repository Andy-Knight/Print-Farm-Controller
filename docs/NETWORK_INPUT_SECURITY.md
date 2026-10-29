# Network input boundaries

Printer HTTP requests reject every redirect. Configure the printer's direct address;
the controller does not replay API keys, Digest authorization or command bodies at a
redirect destination. This includes Snapmaker camera snapshots and file range reads.

Input limits apply before retaining another chunk or waiting for an oversized payload:

| Input | Limit |
| --- | --- |
| Printer HTTP API body / Moonraker upload response | 8 MiB |
| Snapmaker JPEG snapshot / MJPEG parsing buffer | 4 MiB |
| Moonraker WebSocket frame | 4 MiB |
| Bambu MQTT packet / pending payloads | 8 MiB; at most 64 queued packets |
| Bambu FTPS control session | 1 MiB total, 64 KiB partial line/chunk, 16 queued replies |
| Bambu FTPS directory listing / FlashForge TCP command reply | 8 MiB |

Oversized input fails the operation and closes or cancels the affected read. Printer
HTTP body reads have a 10-second absolute deadline in addition to adapter request
timeouts. FTPS listings use the client's transfer timeout (8 seconds by default),
including when data keeps arriving. Existing bounded file-inspection and decoder
limits remain separate from listing/status limits. Large print uploads are streamed;
these response limits do not lower the supported print-file size.

Google Drive bearer tokens are attached only to `https://www.googleapis.com` and
Microsoft Graph tokens only to `https://graph.microsoft.com`. Returned pagination
and upload destinations are validated before sending tokens or backup content.
Credential-bearing requests reject automatic redirects. The supported exception is
a Graph GET `/content` response: the controller follows at most three redirects to
HTTPS `1drv.com` or `sharepoint.com` hosts, without forwarding the Graph token,
caller headers or request body. OneDrive upload sessions use the same provider host
allowlist. Userinfo, nonstandard ports and HTTP destinations are rejected.

Provider contracts: [Microsoft Graph content downloads](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)
and [Google Drive resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads).
Provider destination changes require an explicit allowlist review and regression
tests; failures do not relax the destination policy.
