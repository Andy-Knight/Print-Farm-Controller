# Regression test validity audit — v0.48.0

**Status:** Phase 1 inventory complete and Phase 2 behavioural validation started on `feature/regression-test-audit`; draft PR #90. Do **not** merge until the audit is reviewed and accepted.

## Purpose and baseline

The existing v0.48.0 baseline on `main` contains **81 `test/*.test.js` files** (GitHub tree inventory). This branch introduces an additional test suite for the audit utility, initially bringing the automated inventory to **82 test files and 595 recognised test declarations**. The first behaviour-test batch adds seven cases in `test/queue-bed-clearance-behavior.test.js` (**83 files / 602 recognised declarations** after that addition). The follow-up queue-scheduler and printer-operation audit adds **12 more cases**, reaching **85 files / 614 recognised declarations**. The first green inventory run found **no explicit skipped, todo or focused declarations, and no repeated test descriptions**. These are static, heuristic counts rather than a statement of behavioural coverage. The workflow runs the normal Node regression suite, a separate MinIO S3 integration test, and a Docker container smoke test. All of those verify different things; a passing Node suite does **not** prove that browser interactions or printer firmware integrations behave correctly.

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
| `test/print-queue.test.js`, `test/concurrency.test.js`, `test/printer-operation-policy.test.js` | Exercise imported queue, transaction/coordinator and physical activity policy code using fakes, injected status and assertions | **Keep and strengthen:** New scheduling boundary, fixed-printer dispatch and physical-operation tests now cover starvation aging, tie precedence, review holds, activity changes and lock release. Do not remove existing integration tests. |
| `test/moonraker-api.test.js` | Exercises Moonraker normalization and HTTP test-server interactions | Valuable protocol-level coverage; still requires real U1 validation for firmware-specific behavior. |
| `test/frontend-renderer-diagnostics.test.js` | Executes exported renderer-status functions using fake DOM elements | Behavior tested within a controlled DOM; does not replace an actual Chrome integration test. |
| `test/queue-bed-clearance-click.test.js` | Matches specific `public/app.js` source strings/regexes only | **Strengthened:** `test/queue-bed-clearance-behavior.test.js` now runs the production event handlers, queue rendering, confirmation and action guard in a mock DOM; detects premature redraws, duplicates, cancel/error recovery and pending actions. Browser-native/Preact reconciliation timing still needs a real browser test. |
| `test/ui-print-setup.test.js`, `test/backup-ui.test.js`, `test/production-packaging.test.js` | Substantial source/CSS/packaging assertion coverage | Useful markup/packaging contracts, but potentially fragile after refactors and unable to prove runtime behavior. Review assertions against current features and supplement, rather than blindly remove. |
| `test/toolhead-button-consistency.test.js` | Mixes markup/CSS source assertions with isolated function execution | Retain important button and selector contracts; validate actual rendered width/position in a browser before considering visual layout proved. |
| `test/preact-dashboard-ui.test.js` | Significant Preact source/DOM contract verification | Prioritise rendered state transitions, event delegation, and page refresh in a browser harness. |

## Phase 2: queue and printer-operation behavioural review (2026-10-16)

| Area | Disposition | Evidence and remaining limitations |
| --- | --- | --- |
| Queue priority ageing and manual order | **Strengthen** | `test/queue-scheduler-audit.test.js` asserts exact 6-hour/12-hour boundaries, high-priority cap, no aging after printing or completion, and saved position as a tie-breaker. Fault injection of a 12-hour-only threshold shows the invariant would be violated. |
| Fixed-printer queue dispatch | **Strengthen** | Exercises `PrintQueueService` with persisted queued jobs, an initially offline printer, dispatch pause, and later idle status: aged low-priority work must start before recent high-priority work when tied by effective priority. |
| Priority review hold | **Strengthen** | Simulates a higher-priority `needs_review` job blocking lower-ranked fixed-printer work rather than bypassing required review. |
| Physical printer operation policy | **Keep and strengthen** | `test/printer-operation-audit.test.js` adds scenario-driven checks across idle, printing, paused, chamber preheat, levelling, calibration, manual heating, macro activity, faults and tracked activity. A deliberate print-start allowance during levelling is detected as a policy violation. |
| Concurrent printer operations | **Keep and strengthen** | Verifies dynamic policy re-evaluation at dispatch, same-printer conflict rejection with HTTP 409, independent parallel operations on different printers, lock cleanup after rejection, and invalid printer IDs. An isolated mutation of the transaction lock shows that removing the guard enables dangerous overlap. |
| Legacy source-only queue click tests | **Keep as supplementary contracts** | Production queue handlers are now executed via a DOM/event harness. A real Chromium + Preact event/reconciliation test is still needed to verify browser-native timing. |

The queue scheduling / printer-operation tests directly execute production service and policy code. Fault-injection checks are *sensitivity demonstrations*, not full mutation-coverage scores. The existing emulator and mocked-adapter coverage cannot establish live firmware interoperability.

## Work stages

1. **Inventory** — enumerate the entire suite and annotate runtime, mixed, source-only, skipped and duplicate-description cases. **Baseline complete.** Manually triage suites with misleading heuristic classification and compare suspicious duplicates/absent assertions.
2. **Validity review** — compare each assertion with the current v0.48.0 implementation and user-visible behavior. Mark **keep**, **strengthen**, **replace**, or **remove** with explicit evidence; do not simply delete tests because they mention old implementation details.
3. **Fault-detection checks** — controlled fault injection must demonstrably change test outcomes. **Completed:** disabling the queue redraw guard disconnects the clicked node; increasing the queue-aging interval from 6 to 12 hours breaks the priority boundary; erroneously allowing PRINT_START during bed levelling defeats the safety contract. Mutants execute only in isolated VM copies, never in production files. Next: backup recovery and licence verification.
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
- **2026-10-16:** Added seven executable queue bed-clearance tests using extracted **production** event handlers and render logic. Cases cover one-click success across SSE redraws, Preact publish deferral (through a stub publisher), cancellation, network failure and retry, duplicate click suppression, and disabled pending state. Injected a missing legacy redraw guard in an isolated VM copy and observed the lost click. Both `npm test` and `npm run test:audit` passed in the branch's CI regression steps; standalone MinIO/container workflow completion is tracked separately. Existing source-contract tests are retained as supplementary checks.

- **2026-10-16:** Validated queue-priority aging boundaries, ordering and review-block scheduling with executable service tests; validated operation safety decisions across physical activity states and concurrent-client lock handling. Confirmed fault sensitivity to a doubled aging interval, unsafe print-start allowance during bed levelling, and bypass of the same-printer transaction lock. Tests run against the v0.48.0 code without modifying application behaviour.
