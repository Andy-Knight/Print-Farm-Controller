# Regression test validity audit — v0.48.0

**Status:** Phase 1 underway on `feature/regression-test-audit`; draft PR #90. Do **not** merge until the audit is reviewed and accepted.

## Purpose and baseline

The existing v0.48.0 baseline on `main` contains **81 `test/*.test.js` files** (GitHub tree inventory). This branch introduces an additional test suite for the audit utility. The workflow runs the normal Node regression suite, a separate MinIO S3 integration test, and a Docker container smoke test. All of those verify different things; a passing Node suite does **not** prove that browser interactions or printer firmware integrations behave correctly.

Run:

```sh
npm test
npm run test:audit
npm run test:audit -- --json
```

The audit command dynamically counts test files and declarations, identifies explicit `skip`, `todo` and `only` declarations, and reports repeated test descriptions. A committed `test.only` causes the audit command to fail. GitHub Actions now runs the inventory alongside the normal suite.

**Interpretation:** The inventory classification is a *heuristic*, not coverage evidence. It distinguishes tests that read source files from tests that import/execute code; tests may combine both. Repeated descriptions do not necessarily mean redundant assertions; no test should be deleted without checking what behavior it protects. Filename and declaration counts alone cannot establish validity.

## Initial review findings

| Suite or group | Observed approach | Validation risk / next step |
| --- | --- | --- |
| `test/print-queue.test.js`, `test/concurrency.test.js` | Exercise imported queue/coordinator code with fakes and assertions | Stronger behavioral signal; introduce controlled negative-case mutations to verify that critical regressions are caught. |
| `test/moonraker-api.test.js` | Exercises Moonraker normalization and HTTP test-server interactions | Valuable protocol-level coverage; still requires real U1 validation for firmware-specific behavior. |
| `test/frontend-renderer-diagnostics.test.js` | Executes exported renderer-status functions using fake DOM elements | Behavior tested within a controlled DOM; does not replace an actual Chrome integration test. |
| `test/queue-bed-clearance-click.test.js` | Matches specific `public/app.js` source strings/regexes only | **Priority 1:** A green test does not prove the Bed cleared click fires on the first press during live updates. Add a browser/event interaction regression test. |
| `test/ui-print-setup.test.js`, `test/backup-ui.test.js`, `test/production-packaging.test.js` | Substantial source/CSS/packaging assertion coverage | Useful markup/packaging contracts, but potentially fragile after refactors and unable to prove runtime behavior. Review assertions against current features and supplement, rather than blindly remove. |
| `test/toolhead-button-consistency.test.js` | Mixes markup/CSS source assertions with isolated function execution | Retain important button and selector contracts; validate actual rendered width/position in a browser before considering visual layout proved. |
| `test/preact-dashboard-ui.test.js` | Significant Preact source/DOM contract verification | Prioritise rendered state transitions, event delegation, and page refresh in a browser harness. |

## Work stages

1. **Inventory** — enumerate the entire suite and annotate runtime, mixed, source-only, skipped and duplicate-description cases. Identify tests without any apparent assertions for manual inspection. **In progress.**
2. **Validity review** — compare each assertion with the current v0.48.0 implementation and user-visible behavior. Mark **keep**, **strengthen**, **replace**, or **remove** with explicit evidence; do not simply delete tests because they mention old implementation details.
3. **Fault-detection checks** — introduce *temporary, controlled negative mutations* in an isolated worktree or copy and confirm relevant tests fail; restore source between checks. Start with queue scheduling, printer operation concurrency, backup recovery and licence verification.
4. **Coverage gaps** — add runtime/event tests for live SSE redraw vs. clicks, queued-job state transitions, page refresh, multi-printer group matching, maintenance due-state and printer-specific designation semantics. Identify which checks need real firmware or browser automation rather than a simulator.
5. **Completion gate** — `npm test`, the MinIO integration, and container smoke test pass; no accidental `test.only`; all high-risk assertions have a disposition and meaningful negative-case evidence. Merge only with user approval.

## Verified scope limitations

- Structural regex checks can pass even if the page is blank, a click is ignored, or firmware rejects a command.
- Unit tests using fakes or simulated printers do not prove Snapmaker U1, FlashForge, Prusa or Bambu hardware interoperability.
- CI's independent S3 integration uses MinIO; it does not certify Google Drive or OneDrive live-provider behaviour.
- The new inventory command **reports risk, not correctness or percentage of behavior covered**. Any category totals and flagged names require a human review before action.

## Audit log

- **2026-10-16:** Created `feature/regression-test-audit` from v0.48.0 `main`.
- **2026-10-16:** Established 81-suite pre-audit baseline, reviewed representative runtime and source-only suites, added a dependency-free inventory command and self-tests, and included the inventory in pull-request CI. No existing functional regression test has been deleted or weakened.
