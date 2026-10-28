# Dependency and runtime security policy

## Baseline

- Node.js: supported 24.x LTS, patched to **24.22.1 or newer**. Container and CI builds currently pin **24.22.1**.
- npm: **12.2.0** (declared in `package.json`; installed explicitly in CI and the container build stage).
- Use `npm ci --include=dev` for deterministic installs. Commit `package-lock.json`; never hand-edit package integrity hashes.
- npm 12 blocks unapproved dependency installation scripts; `esbuild@0.28.2` is the explicitly approved script in `package.json`. Review any change to `allowScripts`.
- By default, the project `.npmrc` requires dependencies to be at least **7 days** old and disallows Git/remote URL sources.
- The production container runs the built Node.js application; npm is used only for building, not for starting the server.

## Windows developer setup

1. Install Node.js 24.22.1 or a newer security-patched 24.x LTS.
2. Run `npm install --global npm@12.2.0`.
3. Confirm `node --version` and `npm --version`.
4. In a clean checkout, run `npm ci --include=dev`, `npm audit --audit-level=high`, `npm test`, `npm run test:browser`, and the Windows SEA build when preparing a release.

The local Node.js/npm installations are independent of the dependencies bundled into published container and Windows releases.

## Updates and security exceptions

- Dependabot proposes npm, Docker base image, and GitHub Actions updates weekly. Routine updates have a seven-day cooldown.
- Security updates should be reviewed promptly; do not delay a verified fix merely to satisfy the seven-day window.
- For an urgent vetted fix published less than seven days ago, apply a **one-command override**, such as `npm install --min-release-age=0 <package>@<version>`, review the diff, commit the regenerated lockfile, and run the full test matrix. Do not weaken the checked-in default setting.
- Changes involving installation scripts, new upstream sources, major dependency versions or build tooling need a focused review.
- Do not automatically merge dependency updates: review the release notes and CI results, then merge and publish through the standard main-branch process.
- CI blocks reported high/critical npm audit findings. Any exception must be justified and tracked rather than globally silencing the audit.
- Prefer runtime patches promptly. Assess movement to the next Node.js LTS major separately after its LTS transition and successful compatibility testing.
- The Windows SEA packaging currently rejects Node.js major versions other than 24. Dependabot ignores Node Docker image *major* upgrades while retaining proposals for compatible 24.x updates. Test Node 26+ in a dedicated migration branch before removing the restriction.

## Release validation

The camera decoder is a separately executed, bundled FFmpeg built from the official
source pinned in `scripts/ffmpeg-source.json` and vendored under `third-party/ffmpeg`.
Updates require reviewing FFmpeg security advisories, replacing source and SHA-256
together, rebuilding Windows/AMD64/ARM64, and running the real authenticated RTSPS
fixture on the packaged executables. npm audit does not audit this native dependency.
Do not enable GPL/nonfree components or download executable updates at runtime.
Preserve the matching source, build records, integrity manifest and licence notices
in every portable/installer/container distribution. Windows uses Schannel; Linux
uses patched system OpenSSL 3. See [X1C camera packaging](X1C_CAMERA.md) for build,
licence and commercial patent-review boundaries.

Require unit and regression tests, a real-browser Preact run, the MinIO S3 integration check, container smoke tests and a successful multi-architecture image build. Validate Windows SEA/installer output on Windows before a Windows release. Avoid production promotion from feature branches.
