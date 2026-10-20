# Print Farm Controller — SaaS UI design system (Phase 1)

**Status:** Phases 1–3 merged as v0.54.0 (PR #96); Phase 4 landed as v0.55.0 (PR #98); Printer Details follow-up PR #99 and standardised tabs PR #100 comprise v0.56.0. The Print Library workbench, live readiness and cost workflow (PR #101) comprise v0.57.0. No printer-control protocols, endpoint contracts or edition limits change.

## Product direction
A professional, calm, information-first operations workspace that resembles established SaaS applications while remaining *local-first*: no CDN, external fonts, remote assets or third-party analytics. Dense fleet operations stay legible and users can keep working when printer SSE telemetry refreshes during an edit.

## Token conventions
The browser loads `public/styles.css` and then `public/design-system.css`; the latter defines a `--ds-*` token layer for new Preact surfaces. The existing light/dark user preference (`printer-fleet-theme`) and the existing 42px control-height variables continue to work unchanged.

| Token group | Representative names | Usage |
| --- | --- | --- |
| Colour | `--ds-surface`, `--ds-surface-raised`, `--ds-text`, `--ds-text-muted`, `--ds-border` | Theme-aware contrast for panels, text and dividers |
| Brand/status | `--ds-brand`, `--ds-success`, `--ds-warning`, `--ds-danger`, `--ds-focus` | Actions, alerts and focus feedback |
| Spacing | `--ds-space-1` ... `--ds-space-6` | 4px multiples |
| Radius | `--ds-radius-sm`, `--ds-radius-md`, `--ds-radius-lg`, `--ds-radius-pill` | Consistent edges |
| Typography | `--ds-font-sm`, `--ds-weight-semibold`, `--ds-leading-body` | Headings, labels, helper text |
| Elevation | `--ds-shadow-sm`, `--ds-shadow-md`, `--ds-shadow-pop` | Content, hover, floating feedback |
| Motion | `--ds-duration-fast`, `--ds-duration-normal`, `--ds-easing` | Subtle motion; respects reduced-motion OS settings |
| Control sizing | `--ds-input-height`, `--ds-button-height` | Reuses existing controller field/button heights |

## Shared Preact primitives
`ui/components.jsx` now provides:
- `UiButton` (legacy variant selectors, `busy` spinner and `aria-busy`; button remains disabled during pending action)
- `UiSurface` (semantic polymorphic panel), `UiSectionHeading`, `UiEmptyState`
- `UiInlineMessage` (status or error alert), `UiSkeleton` (decorative, aria-hidden)
- `UiSelectField` (controlled select with explicit validation/hint linkage)
- Existing `UiTextField`, `UiCheckboxField`, `StatusBadge`, `Metric`, `ProgressBar`, `ToastHost`.

Dashboard summary filters gain semantic-tone panel surfaces and the cards/metrics adopt shared tokens. Existing data attributes, actions, card/table switch, sorting, tab routes and SSE subscriptions **must be preserved**.

## Adoption guardrails
1. Avoid giant UI rewrites. Apply the shared primitives to one existing screen at a time; preserve all `data-*` hooks and target selectors.
2. Forms receiving printer telemetry must retain *dirty* user drafts and a pending command state; do not replace live edits on every SSE event.
3. CSS changes must never alter Toolheads selector widths/button alignment, filament colour swatches, or the dense table-view columns.
4. **Printer firmware and the controller backend remain authoritative**. Do not introduce new client-side command paths.
5. Keep the existing no-Preact-bundle HTML fallback operational; the new tokens are purely a presentation enhancement.
6. Meet keyboard/focus, minimum touch-target, contrast and reduced-motion requirements. Prefer WCAG 2.2 AA, verified across light/dark.
7. Preserve responsive usability in Chrome desktop and Android Chrome.

## Regression checks
- `npm test` covers tokens, component contracts, legacy selectors and routing as well as the existing protocol tests.
- `npm run build:frontend` builds the pinned local Preact bundle.
- `npm run test:browser` checks actual Chromium rendering, theme tokens and semantic statuses at desktop and 390px mobile width, plus reduced motion, alongside existing route, printer and Preact regressions.
- Set `PFC_VISUAL_CAPTURE_DIR=<folder>` when running `npm run test:browser` to save **dashboard-dark-desktop.png**, **dashboard-light-desktop.png**, and **dashboard-light-mobile.png** for human comparison/review. The automated gate intentionally checks layout invariants rather than comparing platform-dependent raw pixels.

## Next steps
After Phase 1 baseline passes all tests: apply shared `UiSurface` and typography to application shell/navigation, then dashboard details and Printer Details, then Print Queue/Library, gradually. Only consider Signals after profiling shows reactive-state work is a real bottleneck. Do not add an additional front-end UI framework.

## Phase 2: persistent workspace shell
The second development phase uses `public/shell.css`, loaded after `design-system.css`. The sidebar now uses consistent inline SVG navigation icons, grouped navigation categories, responsive spacing, clear active/current-page treatments and a persistent footer for connectivity, licensing and version information.

The top bar shows the sidebar section name **Farm management** for the six routes grouped under FARM MANAGEMENT (Maintenance, Printer groups, Reports & finance, Alerts & notifications, Backup & recovery, and Diagnostics); other routes show their own page titles. It also retains the route-specific descriptive subtitle, updated by the existing `renderControllerRoute()` function. The blue in-page heading remains route-specific. Redundant workspace breadcrumbs have been removed from all routes (including the no-bundle fallback). The persistent sidebar and its `aria-current` state provide the navigation hierarchy, with the controller still owning browser history, APIs, dialogs, keyboard focus and printer-command safety. The top bar is now 64px high on desktop and at least 60px on mobile; `body > main` uses a consistent 18px / 16px top gap before each page's shared blue heading.

On screens <=760px, the sidebar becomes a modal-like drawer with a dimmed backdrop, Escape and backdrop dismissal, focus restoration, keyboard Tab containment and `inert` while closed. Mobile users gain an explicit Add printer button inside the drawer that delegates to the pre-existing Add Printer action. Desktop sidebar navigation is always available. This preserves existing HTML element IDs, route data attributes, keyboard actions and SSR-free behaviour.

Chromium browser tests cover desktop shell geometry, breadcrumb-free direct routes, sidebar navigation to Dashboard, browser history, route titles and subtitles, active-route semantics, consistent top padding, mobile focus/close behaviour and opening Add Printer from mobile. Under `PFC_VISUAL_CAPTURE_DIR`, GitHub Actions captures both themes on the desktop and a light-mode open drawer on mobile for review. No print/protocol/backend modifications.

### Dashboard card image alignment regression
After Phase 1, long printer names and multi-line model details caused some card headers to grow independently, shifting the printer pictures out of alignment in card view. The fix in `public/design-system.css` uses **CSS row subgrid** so cards within the same responsive fleet row share header and image tracks. The highest header sets the shared picture baseline without globally increasing header height or truncating printer names. Activity banners and the card body/footer have separate shared tracks. The existing table view retains its compact layout; a bounded header-height fallback is supplied for browsers without row subgrid.

The Chromium design-system smoke now renders five printers with mixed-length names, measures the picture-slot positions at 1365px and 1800px, asserts they agree within 1.5 pixels per row, and verifies headings do not clip or overlap the images. It also captures the populated dashboard in light/dark themes for visual review.

## Phase 3: operational dashboard visual hierarchy
Phase 3 adds `public/dashboard-polish.css` after `public/shell.css`. The Preact dashboard now opens with a compact **Farm overview** header, the established printer group/card-table controls, four consistently sized actionable status summaries with supporting descriptions, and a **Printers** section heading which follows the controller-reported number of configured printers and the selected view.

Printer cards gain consistent typography, restrained surfaces, better progress/metric hierarchy, an accessible Open printer action, and subtle focus and hover states. This phase **does not** change status calculations, sort/queue logic, equipment images, filament swatches, backend APIs or Preact/legacy control hooks. The Phase 1 shared CSS subgrid tracks continue to align printer images across a row even when names/models wrap, and all new printer-card CSS targets `.fleet:not(.table-view)` to protect compact table alignment.

Use Chrome desktop and Android Chrome in both light/dark modes to confirm the visual spacing, card/table switch, wrapped printer name alignment, keyboard controls and mobile stacked summary. Real Chromium regression adds a Phase 3 dashboard smoke for summary labels/counts, filter/view actions, typography theme checks and a 390px viewport. `PFC_VISUAL_CAPTURE_DIR` also captures `dashboard-phase3-dark-desktop.png`, `dashboard-phase3-light-desktop.png` and `dashboard-phase3-light-mobile.png`. These are review artefacts, not brittle pixel-perfect CI gates.

## Consistent workspace page headings (Phase 3 follow-up)
Dashboard and all nine main routed pages now share the same `ui-page-heading`, `ui-page-heading-copy`, `ui-page-eyebrow`, `ui-page-title` and `ui-page-description` classes. The single token-driven definition lives in `public/dashboard-polish.css`, loaded after legacy layout rules. Eyebrow colour and casing, title size/weight, caption typography, vertical rhythm and dark/light appearance are the same on Dashboard, Queue & History, Print Library, Printer Groups, Maintenance, Reports, Alerts, Backup, Diagnostics and Licence.

The old modal-style divider and oversized heading on route pages are removed, but live page-specific subtitles (such as queue/history totals) and existing action/control IDs are preserved. Pop-up dialog titles remain independent of the workspace page-heading layout. Unit tests cover all nine main routes; the Chromium visual contract compares the actual computed eyebrow, title and description styles against the Dashboard in both themes plus the 390px mobile viewport.

## Phase 4: Printer Details visual redesign

Printer Details now uses a dedicated, locally served `public/printer-details-polish.css` stylesheet loaded after the shared design system, shell and dashboard styles. The modal displays the controller printer name, reported model, connection host, status badge, actionable maintenance icon and live health text as a clear identity block. Light and dark themes reuse `--ds-*` tokens for headers, surfaces, tabs, activity and muted captions.

The existing six tabs (Toolheads, Camera, Files, Temperature/Preheat/Fans, Current Job and Maintenance/Management) are unchanged; selected tabs use a more legible active indicator. On narrower screens the tab rail is **one horizontally scrollable row**, avoiding a six-row stack that obscures the content on Android. Home/End/left/right keyboard handling is retained, and both the Preact tabs and legacy fallback now label their tab panels explicitly using `aria-labelledby`.

All existing controller operations remain wired to the original event handlers and APIs, including filament and nozzle assignments, camera, files, bed/fan/chamber temperature and preheat controls, jobs, rename, maintenance and diagnostics. The calibrated **160px toolhead selector widths**, aligned Set filament/Assign buttons, colour swatches, dense per-toolhead table, pending drafts and live telemetry refresh must remain unchanged. The existing no-bundle fallback remains supported.

### Verification

Run `npm test`, `npm run build:frontend`, and `npm run test:browser` with Node 24. Chromium's simulated AD5M checks assert the printer identity header, all six labelled panels, token styling, responsive one-row tab scrolling, Home/End keyboard navigation, and existing filament/nozzle alignment and state-preservation behaviour. With `PFC_VISUAL_CAPTURE_DIR` set, it also writes:

- `printer-details-phase4-dark-desktop.png`
- `printer-details-phase4-light-desktop.png`
- `printer-details-phase4-light-mobile.png`

Manually review Snapmaker U1, Flashforge AD5M/Pro, Creator 5/Pro, Prusa CORE One+ (Standard/INDX4/INDX8) and Bambu external spool/AMS in Chrome desktop and Android Chrome, both themes. Confirm all tabs and enabled/disabled states, live telemetry during unsaved changes, error messages, mobile scroll/keyboard access and full-width table positioning. The Phase 4 redesign was accepted after user review and included in the v0.55.0 merge; continue physical-hardware validation as equipment is available.

## Printer Details navigation follow-up — minimal underline tabs

After reviewing four visual examples, the chosen **Option A** replaces the filled segmented navigation with a restrained six-tab text-and-icon strip. All sections have a 17px monochrome outline icon (Toolheads sliders, Camera, Files, Temperature thermometer, Current Job clock, Management wrench). Icons inherit the active/inactive text colour through locally embedded CSS SVG masks, requiring no internet assets; they are purely decorative and do not change accessible names. The active tab has a blue bottom underline instead of a filled button.

Visible labels shorten only two entries to **Temperature** and **Management**. Their complete original scope is maintained with accessible labels ("Temperature, Preheat & Fans" and "Maintenance & Management") in both Preact and no-bundle fallback. All six original tab and tabpanel IDs, click handlers, selected states and arrow/Home/End keyboard navigation are retained. The underline navigation stays on a single horizontally scrollable row at narrow widths. This change is presentation-only; it does not touch toolhead tables, printer protocols, status, control forms or action button geometry.

## Printer Details rich identity header

User review of mockup A requested the upper identity region in addition to the icon underline tabs. The header now reuses the controller's **existing local model image assets** and displays six labelled facts with consistently styled outline icons: Model, Connection, Host / IP, Uptime, Firmware and Connection health. The printer name, existing live status, maintenance action, and last-response/latency diagnostics remain visible. The two-column metadata panel adapts to a single column on narrower/mobile displays; existing toolhead controls below the tabs are not changed.

**Data integrity:** firmware comes from printer status `firmwareVersion` and shows “Not reported” when absent. Uptime is shown only if an adapter explicitly supplies nonnegative `uptimeSeconds`; last-seen and connection duration are not printer uptime and must never be substituted. “Connection health” describes the controller's online/poll-failure state, not mechanical health. Both Preact and the no-bundle fallback use the same source fields and update during telemetry refresh. No new printer protocol reads or backend changes were introduced.

## Print Library workbench — feature branch

The Print Library now uses a **single-selection workbench** rather than action buttons inside each item. The contextual action toolbar is directly below Search / Add file, has an `aria-live` selected-file indicator, and only enables Queue/Edit when a visible file is selected. Delete remains disabled while queue/history references exist. Clicking a row or its dedicated selection button selects it; clicking again clears the selection. Thumbnail preview is independent. Keyboard selection uses a focusable `aria-pressed` button, not a non-semantic row-only click target.

At desktop widths, a fixed shared CSS grid aligns column headings and entries: Select, Preview, File, Printer, Filament & requirements, Estimated cost and History. The library deliberately inherits **the controller-wide table skin in `public/styles.css`** via `--pfc-table-*` tokens rather than independently defining header colours or row states: white uppercase bold heading text on the existing dark header, canonical border/divider spacing, table surface, hover and selected row highlighting, in light and dark themes. Below 1180px the presentation becomes row-labelled cards and below 700px it stacks key fields without horizontal scrolling. The same row structure is produced by Preact and the no-bundle HTML renderer, using shared CSS in `public/print-library-polish.css`; existing light/dark design-system colours and minimum 42px action buttons are retained. The library's flex-column route shell has a viewport-aware maximum height; the headings, search field and contextual buttons are outside the sole scrolling region (`#libraryList`). Desktop heading and body reserve matching thin scrollbar gutters so grid columns remain aligned on non-overlay Windows scrollbars. Mobile keeps its labelled card layout and internally scrolls the cards, with touch momentum and overscroll containment; short libraries keep a natural content height rather than a large forced empty scroll panel. Filament costs remain current raw-material estimates, not historical queue snapshots or total manufacturing costs.

## Phase 4.1 — standardised icon underline navigation (v0.56.0)

The **Option A** selected for Printer Details is now the shared style across every existing multi-panel navigation: Printer Details, Maintenance Tracking, Printer Groups, Reports, Alerts & Notifications and Backup & Recovery. Each area retains its own tab labels, saved active-selection behaviour, controller APIs, form state and keyboard handlers. View toggles such as dashboard card/table switching are **not** tabs and deliberately keep their button treatment.

`public/tab-navigation.css` is loaded after the existing design system and all legacy/printer-specific styles. Its scoped `[data-pfc-tabs]` contract supplies transparent backgrounds, a thin tab-rail divider, a selected blue underline, uniform icon/label spacing, keyboard focus indication, reduced-motion support and a single horizontal scrolling row at narrow widths. Locally embedded monochrome SVG masks inherit text colours and never request assets from the network. Each tab declares a semantic `data-pfc-icon` name. No global override of `.maintenance-view-button` or `.backup-tab` affects non-tab controls.

`UiTab` in `ui/components.jsx` is the common Preact tab primitive; it composes the established `UiButton` without changing delegated controller events or page-owned selection. Static/no-bundle fallback navigation uses the same `data-pfc-tabs` / `data-pfc-icon` presentation contract and retains its working handlers. This rollout is intentionally visual, not a replacement of maintenance/queue/backup business logic.

### Validation and release sequencing

User acceptance and feature-branch test gates have completed for both parts. PR #99 (Printer Details) was merged first. PR #100 was then retargeted to `main`, the application version advanced to v0.56.0 and the combined release submitted for its final CI gate. Continue to test printer-specific UI on physical hardware where available.

## Print Library Phase 2 — production search, sorting and scale

On top of the selected-file toolbar and canonical seven-column `--pfc-table-*` styling, the Print Library now has:

- Click-to-sort desktop header buttons for filename, target printer, filament, material cost and completed jobs, with direction reversal and keyboard focus states. Other fields (date added, last printed, duration, weight and readiness) are available from a named sort dropdown inside **Advanced filters**.
- Multi-facet filtering by designated printer type, slicer filament material, primary category, tags, known vs unavailable costing, live readiness and favourites, combined with the existing full-text search.
- Validated per-file `category`, `tags` and `favourite` fields persisted in the existing print-library metadata JSON, maintained with the current PATCH API; legacy backups/files default to a blank category, no tags and not-favourite. Category and tags are searchable and visible in the file row. No revisions/version history has been introduced.
- Slicer-estimated duration from explicit Orca/Prusa-style estimate lines and Cura `;TIME:` (including embedded 3MF G-code), with `Not reported` for unknown values; filament grams show only if each logical tool reports a reliable weight. User-selected **batch quantity** multiplies the current raw-material cost estimate without initiating prints or changing historical queue cost snapshots.
- A **readiness preview** derived from the existing `evaluateQueueCompatibility` implementation and current printer status; green is reserved for verified online printer/material/tool evidence. Unknown metadata, no suitable online printer and other review conditions are amber; known incompatibility is red. This is a snapshot, not an authorization to bypass the real job's queue-time preflight. The current printer configuration can change at any time.
- 80 rows per client page to bound Preact/legacy DOM size, with Previous/Next controls in the table's scrolling region. Backend library metadata reads are capped at 12 concurrent filesystem operations, and usage references are indexed once per snapshot; cost catalogue prices are still read once per request. Pagination currently occurs **client-side**, so the API still returns the full listing, which remains necessary for fleet history and search consistency. Server-side pagination may be considered if very large libraries become common.

The advanced filters are collapsed by default, keeping Search/Add, the selected-file toolbar, live item count and canonical heading row permanently visible on long lists, including on narrow screens. The table's file body alone scrolls.

### Print Library printer availability badges

A compatible file targeting an offline printer now displays **Printer offline** rather than **Needs attention**. Files whose suitable printer is temporarily occupied display **Printer busy**. Actual material/nozzle configuration conflicts or incomplete sliced metadata still display **Needs attention**; static printer/file incompatibility remains **Incompatible**. The **Ready now** state continues to require verified, online tooling and filament information, and queue preflight remains authoritative. Offline spool/nozzle telemetry is treated as unverified rather than as a current defect.

The existing fleet Server-Sent Events trigger a trailing, throttled (at most every eight seconds) refresh of **GET /api/library/readiness** only while the Library route is active. That endpoint computes compatibility from current printer state without recalculating prices or full queue history. Only readiness is merged into the existing library data, preserving file selection, search/filter state, page and scrolling. The advanced readiness filter includes the two new statuses; separate neutral and blue badge styles follow the shared light/dark design system. 
