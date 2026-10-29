# Windows installer downloads and release drafts

GitHub Releases hosts downloadable Windows installers. Source ZIPs contain source
code and do not contain the built installer. Builds and user data do not belong in
Git history.

## Automatic preparation

After a new controller version is merged into `main`, **Controller CI and
Container Release** builds the Windows executable and Inno Setup installer. The
Windows job runs the full regression suite and uploads a 30-day workflow artifact
named **windows-installer**. Pull requests also validate packaging but never
create releases or receive the production installed-app OAuth configuration.

Only `main` push runs and manual runs explicitly selecting `main` can create a
release draft. The draft job waits for the Windows, Linux/MinIO, Chromium,
container smoke and production AMD64/ARM64 image-build gates. No draft is created
when a required gate fails. Installer source changes also trigger validation.

For a version with no existing release, the workflow prepares a **draft** tagged
`v<version>`, targeting the exact validated source commit. Its notes use that
version's newest `CHANGELOG.md` entry. The release name follows
**v<version> Print Farm Controller** (for example, **v0.61.12 Print Farm Controller**).
The attachments are:

- `PrintFarmController-Setup-v<version>.exe`
- `SHA256SUMS.txt`
- `release-metadata.json` (version, source commit and installer size/checksum)

The installer includes FFmpeg, its matching source and licence notices. Main
builds include the existing shared installed-app Google/Microsoft OAuth settings
when their repository secrets are configured. Those settings are intentionally
part of the installed application; code-signing keys are separate.

Drafts are not public downloads. They are visible to repository users with
sufficient access. This workflow never publishes a release or marks it latest.
The draft job alone has `contents: write`; it uses the short-lived repository
workflow token, so no personal access token is required. Repository rules must
allow that token to create the version release/tag; failures remain visible in
Actions and do not weaken repository rules.

## Review and publish

1. Open the repository's **Releases** page and open the new draft.
2. Review the release notes, source commit and three attachments. Test the
   installer on the intended Windows deployment.
3. Verify the downloaded installer using PowerShell:

   ```powershell
   Get-FileHash .\PrintFarmController-Setup-v<version>.exe -Algorithm SHA256
   ```

   Compare the result with `SHA256SUMS.txt`.
4. Edit the draft and choose **Publish release** when ready. The installer then
   appears under **Assets** for users to download. Public installer downloads
   remain available as release assets independently of workflow artifact expiry.

Automated installers are **unsigned** and the draft notes say so. Windows can
show an unknown-publisher/SmartScreen notice. For a signed distribution, use the
existing `npm run release:windows` signing process with an appropriate certificate
and timestamp service. Replace the draft's attachments/checksums and update its
signing notes before publishing; signing is not configured by this automation.

## Repeats and recovery

An existing published release or draft with all three completed attachments is
left unchanged. Further source changes need a new version. The workflow never
replaces assets, moves a version tag or republishes an old version.

If an upload fails, rerun the failed draft job in the **same workflow run**. It
can resume missing attachments when the draft belongs to the same commit and
installer checksum. Uploaded attachments are checked against GitHub's recorded
SHA-256 digests. A different build, a conflicting tag, a failed starter asset or
corrupt metadata stops the job. Inspect the draft; remove the incomplete draft or
failed asset deliberately before retrying. Do not delete an already published
release to work around a version conflict.

To retry preparation after fixing a build or host issue, use **Actions →
Controller CI and Container Release → Run workflow**, selecting `main`. This
reruns validation and image building before the draft job. Selecting a feature
branch only validates that branch and never creates a release. Automation does
not backfill older versions; a manual run uses the selected main commit's version.

GitHub's [release guide](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
explains draft review/publication. The [release assets API](https://docs.github.com/en/rest/releases/assets)
documents the size/state/SHA-256 metadata checked after uploading.
