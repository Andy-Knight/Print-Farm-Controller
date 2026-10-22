# Print Farm Controller — repository instructions for contributors and AI agents

Applies to the entire repository. These are permanent working rules, not a version changelog.

## Start of every task, including a new ChatGPT conversation

1. Identify the active repository, branch and latest commit. For application facts and API behaviour, inspect actual code/tests; the GitHub repository wins over chat memory.
2. **Read `PROJECT_CONTEXT.md` and `docs/DOCUMENTATION_POLICY.md`.** For UI work also read `docs/CONTROLLER_VISUAL_STYLE_GUIDE.md`. Consult `docs/dependency-security.md` before changing runtime or dependencies.
3. Use `PROJECT_CONTEXT.md` for current priorities, architecture, decisions and known validation limits. Replace stale task descriptions when work completes.
4. Work in a feature branch/PR, run relevant unit, browser, packaging and documentation checks. Do not merge or claim a release is published without explicit user approval and verification.

## Documentation contract

- **`README.md`:** current features, supported printers, usage, installation, configurations and deployment. A current version header is permitted. **Do not add historical per-version changes, former versions or release diaries.**
- **`CHANGELOG.md`:** the **only** authoritative chronological record of releases and fixes. New release versions get a new entry here.
- **`PROJECT_CONTEXT.md`:** up-to-date handoff, architecture, long-lived decisions, risks and current task. Never append the same release notes already captured by the changelog.
- **`docs/CONTROLLER_VISUAL_STYLE_GUIDE.md`:** canonical specification of icons, typography, colours, buttons, switches, tables, layout and accessibility. `docs/DESIGN_SYSTEM.md` is retained for historic implementation context, not current visual authority.
- **`docs/DOCUMENTATION_POLICY.md`:** complete ownership/update matrix; follow it on every PR.

When shipping a version, update `package.json` and lockfile versions, current-version metadata in README and PROJECT_CONTEXT, and the corresponding `CHANGELOG.md` entry. Documentation-only PRs do not need a version bump.

## Quality gates

- Run `npm ci --include=dev` in a fresh source checkout; `npm test` covers the repository's documentation policy as well as product regressions.
- GitHub's dedicated documentation workflow checks docs-only changes even when the container CI's path filters exclude those files.
- Review readability and technical accuracy in addition to passing tests. Do not treat a green test as proof of printer-side hardware validation.
- Keep separate persistent data/log volumes and signed-licensing safety assumptions intact; no runtime entitlement bypasses.

## ChatGPT Project setup

Repository rules apply to any assistant that reads them, but a new ChatGPT conversation does not automatically fetch GitHub files. To enforce **startup reading across chats**, copy the Project instruction from `docs/DOCUMENTATION_POLICY.md` into the Print Farm Controller ChatGPT Project settings. CI checks still protect the repository even when an assistant misses its startup instruction.
