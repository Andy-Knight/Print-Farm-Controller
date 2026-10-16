# Regression test validity audit — v0.48.0

**Status:** Phase 1 inventory complete and Phase 2 behavioural validation in progress on `feature/regression-test-audit`; draft PR #90. Do **not** merge until the audit is reviewed and accepted.

## Purpose and baseline

The existing v0.48.0 baseline on `main` contains **81 `test/*.test.js` files** (GitHub tree inventory). This branch introduces an additional test suite for the audit utility, initially bringing the automated inventory to **82 test files and 595 recognised test declarations**. The first behaviour-test batch adds seven cases in `test/queue-bed-clearance-behavior.test.js` (**83 files / 602 recognised declarations** after that addition). The follow-up queue-scheduler and printer-operation audit adds **12 more cases** (**85 files / 614 recognised declarations**). The backup/recovery and licence-security audit then adds **11 cases**, bringing the branch to **87 test files / 625 recognised declarations** before cleanup. Six replaced source-inspection tests were subsequently removed, leaving **87 files / 619 recognised declarations**. The 619 figure is a static inventory count, not a count of independently verified behaviours. The first green inventory run found **no explicit skipped, todo or focused declarations, and no repeated test descriptions**. These are static, heuristic counts rather than a statement of behavioural coverage. The workflow runs the normal Node regression suite, a separate MinIO S3 integration test, and a Docker container smoke test. All of those verify different things; a passing Node suite does **not** prove that browser interactions or printer firmware integrations behave correctly.

Run:

```sh
npm test
npm run test:audit
npm run test:audit -- --json

# Real browser checks (requires dev dependencies and installed Chromium):
npm install --include=dev
npx playwright install chromium
npm run test:browser
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
| Legacy source-only queue click tests | **Replace redundant assertions** | Removed two source-string-only queue click/pointer interaction tests after the real-handler harness and Chromium delegated-click test passed; retained the distinct dashboard-card cancellation source contract until a browser scenario covers it. |

The queue scheduling / printer-operation tests directly execute production service and policy code. Fault-injection checks are *sensitivity demonstrations*, not full mutation-coverage scores. The existing emulator and mocked-adapter coverage cannot establish live firmware interoperability.

## Phase 2: backup/recovery and licensing review (2026-10-16)

| Area | Disposition | Behavioural evidence / remaining limitations |
| --- | --- | --- |
| Staging atomicity and cancellation | **Keep and strengthen** | `test/backup-recovery-audit.test.js` stages a valid archive, rejects a second restore (HTTP 409), verifies no change to live printers/library/licence, then cancels idempotently. |
| Corrupted archive rejection | **Keep and strengthen** | Deliberately damages ZIP header bytes before staging and confirms no pending marker or live data mutation; existing `backup-recovery.test.js` already exercises payload corruption/CRC. |
| Startup/rollback across resources | **Keep and strengthen** | Real staged activation with queued/printing recovery holds, removal of obsolete external licence, and automatic rollback of original printer data, queued jobs, Print Library bytes and previous licence when startup is not committed. |
| Missing rollback snapshot | **Strengthen** | After activation, deliberately removes the saved printer snapshot and confirms next startup rejects recovery without first deleting the currently active printer store. This is **fail-safe rejection**, not evidence a missing snapshot can be recovered automatically. |
| Commit retention | **Keep** | Commits an activated restore and checks subsequent startup preserves restored state; cancellation is prohibited after activation. Existing retention-expiry test covers cleanup. |
| Recovery safety transform | **Strengthen** | Injects an unsafe recovery-hold assignment into a VM copy of the production function. Normal result sets `needs_review`, clearance interlock and `restoreRecoveryHold:true`; the injected mutant violates the hold assertion. |
| Licence signature and entitlements | **Keep and strengthen** | `test/licensing-security-audit.test.js` signs test licences with temporary Ed25519 keys; installed loader uses declared printer caps, respects 5-physical-printer boundary and ignores simulated slots. |
| Licence tampering and untrusted keys | **Strengthen** | Changes signed edition, printer cap, features, licence type and expiry/update information, plus incorrect/untrusted signing keys. Verifier rejects altered signatures and production loader stays Community with a 3-printer cap even if bypass-related environment variables are present. |
| Expired subscription | **Keep** | Ensures a correctly signed but expired subscription retains identity for diagnostics, while edition/features/printer cap fail closed to Community. |
| Licence signature fault injection | **Strengthen** | Mutates the isolated real verifier to always accept signature checks; a tampered licence then receives the elevated 25-printer payload. The unmodified verifier rejects the same payload. |

Existing `test/disaster-recovery-e2e.test.js` already verifies multi-resource restore, recovery-held jobs, disabled restored schedules, and Community fallback for an invalid signed licence. No duplicate standalone end-to-end workflow was added. New scenarios use temporary local directories and synthetic licence keys, **not real customer data or remote backup providers**. These checks do not replace physical recovery drills, access-permission testing on NAS/K3s, browser tests, or cloud-provider authentication tests.

## Phase 2: live Chromium/Preact validation (2026-10-16)

Added `scripts/browser-regression.mjs` and a dedicated **Chromium Preact regression** GitHub Actions job. Unlike the existing source-pattern assertions, this starts a real controller server using a temporary, isolated data directory, loads the **built frontend bundle**, drives an actual Chromium session, and fails on browser JavaScript exceptions. The test can also target a user-supplied controller URL via `PFC_BROWSER_TEST_BASE_URL`; use only an isolated testing instance for this option.

| Area | Verification |
| --- | --- |
| Preact build/fallback | Verifies `/dashboard-preact.js` is actually served as JavaScript and the browser reports **13/13 Preact presenters** initialized, with zero legacy fallbacks. A fresh ZIP without a frontend build must fail this test. |
| Direct route load and refresh | Visits **all 10 controller routes** directly, reloads each with Chromium's actual browser refresh, checks the selected route and visible nonempty routed UI. |
| Reporting | Waits for populated Preact KPI cards and the reporting-period indicator after opening **/reports** directly and after browser refresh. Exercises both reporting tabs. |
| Navigation/history | Uses actual sidebar clicks and browser Back/Forward, checking URL and route visibility. |
| Live UI presentation | Publishes report and fleet state events through the existing Preact event bridge; verifies KPI updates, in-place printer-card progress/tool/job updates and keyed-card removal without duplicate cards. |
| Queue Bed cleared action | Injects an isolated backend queue fixture, verifies a rendered Preact clearance button, publishes a Preact queue summary update, clicks via Chromium and verifies **exactly one** intercepted POST and clearance-row removal. Real firmware is never contacted. |

**CI requirements:** The browser job installs development dependencies (which rebuild the bundle), downloads pinned Playwright Chromium and system libraries, runs `npm run test:browser`, and saves a screenshot artifact if a browser check fails. The container smoke stage now requires **both** the existing Node/MinIO job and the browser job.

**SSE transport follow-up completed:** The browser regression now starts the integrated **Snapmaker U1 simulator** within the temporary controller, registers it using the real `/api/printers` endpoint, observes native `EventSource('/api/events')` fleet events, checks the actual Preact printer card appears, then starts a simulated print through the simulator's protocol endpoint and verifies a subsequent server-published `printing` state updates the **same card**. No `/api/fleet` or `/api/events` route interception is used in this scenario. CI completed this test successfully (Chromium browser job for commit `8e5e92e`).

**Remaining limits:** The report/KPI live-event checks and queue clearance HTTP responses still use synthetic browser fixtures. The new simulator SSE scenario exercises the full loopback printer-protocol → controller polling → SSE → Preact path, **not real physical printer firmware**. It does not yet interleave a user pointerdown with real SSE updates to the queue (the separate handler-level audit covers that race). No cloud account or production data is used.

## Source-only assertion validity and overlap review (2026-10-16)

The automated inventory initially identified **21 source-inspection suites** out of 87, alongside **40 runtime** and **26 mixed** suites. It reported **zero exact duplicate test descriptions**, but descriptions alone cannot reveal semantic duplication. Source assertions remain useful for accessibility hooks and styling contracts but are not treated as functional proof.

| Reviewed suites | Disposition | Reason/evidence |
| --- | --- | --- |
| `test/queue-bed-clearance-click.test.js` | **Replace 2 tests; keep 1** | Two assertions checked that pointer guards and a pending-action Set existed in source without executing a click. Those scenarios are now tested by `test/queue-bed-clearance-behavior.test.js` and the Chromium queue POST test. The remaining test checks a distinct dashboard-card cancellation/re-enable path not yet fully exercised in Chromium. |
| `test/preact-dashboard-ui.test.js` | **Replace 4 tests in total; retain component contracts** | Removed two route refresh checks relying on string positioning/page-loader source, the redundant `v0.47 Preact migration audit` (static initializer list), and the source-pattern Preact queue pointer guard check. Chromium now visits and refreshes all 10 routes, verifies all 13 presenters, and executes a real queue click; `queue-bed-clearance-behavior.test.js` exercises the pointer guard and publication deferral in the production handler. Preact markup, selectors, ARIA and fallback contracts remain. |
| `test/dashboard-filter-stability.test.js`, `test/dashboard-table-view.test.js` | **Keep as fallback and CSS contracts; browser enhancement recommended** | Assert DOM stability, sortable headers, light-mode colours, and specific responsive CSS. The legacy path remains supported even after Preact migration. Mere CSS-source presence cannot establish pixel alignment; real-browser view/sort testing is separate future work. |
| `test/queue-ui.test.js`, `test/branding-ui.test.js`, `test/dialog-ui.test.js` | **Keep source contracts** | Text labels, common button heights and branding/design tokens are deliberate HTML/CSS contracts rather than behavioural tests. Their checks are inexpensive and not equivalent to print-queue command coverage. |
| `test/alerts-ui.test.js`, `test/backup-ui.test.js`, `test/maintenance-ui.test.js`, `test/printer-groups-ui.test.js`, `test/reporting-ui.test.js`, `test/diagnostics-ui.test.js` | **Keep presentation contracts; behaviour supplemented** | The assertion-heavy suites validate specialized control/data-hook presence. Existing behavioural services and Chromium route tests add runtime evidence; visual correctness and all subdialog interactions are not exhaustively validated. |
| `test/dashboard-filament-swatches.test.js`, `test/dashboard-printer-images.test.js`, `test/add-printer-virtual-ui.test.js`, `test/emulator-ui.test.js`, `test/flashforge-creator5-ui.test.js` | **Keep device model and styling contracts** | Protect model-specific toolhead/display and simulator-control contracts. These model-specific source checks are not interchangeable with protocol-adapter tests or real-printer verification. |
| `test/ui-print-setup.test.js` (57 tests) | **Keep all tests; remove 2 exact-overlap assertions** | Reviewed all 57 cases individually against newer queue, adapter, Preact, and Chromium suites. Removed repeated `structureValid` and generic delegated-click listener checks from the dashboard-summary case; `test/dashboard-filter-stability.test.js` already asserts them more precisely. Retained the legacy DOM reconciliation test (`insertBefore`), which is **not** superseded by Preact keyed-card tests, plus special printer UI, modal/camera, queue, SSE backpressure, and button/dropdown styling contracts not covered by the new browser smoke. |
| `test/production-packaging.test.js`, `test/release-version.test.js` | **Keep non-runtime packaging contracts** | Ensure version, installer, asset and release metadata consistency; browser actions cannot replace source packaging validation. |

**Removed six redundant source-only test declarations in total (four earlier, two in the final review), plus two duplicated assertions from the 57-test UI print setup suite.** No entire suite file was deleted and no runtime regression assertions were weakened. The six dropped cases were about implementation strings or static initializer lists already covered more effectively by working behavioural and Chromium tests. The legacy dashboard renderer remains supported, so its unique tests stay. This is a targeted overlap review rather than a formal mutation-coverage proof for every assertion.

## Work stages

1. **Inventory** — enumerate the entire suite and annotate runtime, mixed, source-only, skipped and duplicate-description cases. **Baseline complete.** Manually triage suites with misleading heuristic classification and compare suspicious duplicates/absent assertions.
2. **Validity review** — compare each assertion with the current v0.48.0 implementation and user-visible behavior. Mark **keep**, **strengthen**, **replace**, or **remove** with explicit evidence; do not simply delete tests because they mention old implementation details.
3. **Fault-detection checks** — controlled fault injection must demonstrably change test outcomes. **Completed:** disabling the queue redraw guard disconnects the clicked node; increasing queue-aging from 6 to 12 hours breaks priority; allowing PRINT_START during bed levelling defeats the safety contract; bypassing the same-printer coordinator lock enables overlap; removing restored-job recovery hold violates restart safety; bypassing Ed25519 verification admits an unsigned privilege escalation. Mutants execute only in isolated VM copies, never in production files. Next: browser-native UI behaviour and additional recovery failure modes.
4. **Coverage gaps** — browser route refresh and the simulated U1's real SSE update path now have executable coverage. Still consider an SSE/pointerdown concurrent queue race, dashboard table-sort pixel/interaction checks, multi-printer group matching, maintenance due-state, cloud-provider credentials, and model-specific designation behaviour against real firmware.
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

- **2026-10-16:** Added six restore-safety and five licence-integrity behavioural checks. Demonstrated the consequences of suppressing the restored-job recovery hold and Ed25519 verification via isolated VM mutants, plus actual stage/cancel/activate/rollback and fail-closed signed-licence loading. The Node regression suite and inventory checks passed on the audit branch; follow-up MinIO and container smoke checks run independently in GitHub Actions.
- **2026-10-16:** Added real Chromium regression tests for all route refreshes, reporting, navigation/history, Preact fleet/queue event handling and bed-clearance POSTs. Browser builds run independently in CI and gate the container smoke job. This closes the previous gap where source-only Preact assertions passed despite an absent bundle; SSE transport and real-firmware verification remain outstanding.

- **2026-10-16:** Completed integrated Snapmaker U1 simulation in the Chromium runner: real controller registration, periodic status polling, actual SSE fleet transport, and in-place Preact card update on simulated print start. Removed four stale source-only assertions that duplicated now-passing executable regressions; retained 21 source-inspection suite files for justified markup/fallback/model/packaging contracts. CI's test, Chromium and container smoke jobs passed on the SSE implementation commit; multiarch image build is a separate publishing/build concern.

- **2026-10-16:** Final source-only cleanup removed two further redundant Preact test declarations (queue pointer guard source regex and v0.47 static route initializer audit) after actual Chromium and handler regression coverage was confirmed. Examined all 57 `ui-print-setup.test.js` cases; retained all 57 because they protect distinct legacy, device, markup or styling contracts; removed two exact-overlap assertions also present in `dashboard-filter-stability.test.js`. No production file changes. Final inventory: 87 test files, 619 recognised declarations.
