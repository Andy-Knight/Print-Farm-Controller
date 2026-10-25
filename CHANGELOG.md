# Changelog

This file contains the version-by-version release history for Print Farm Controller.

Historical entries describe the behaviour of the controller at the time of that release and may be superseded by later versions. For current installation, configuration and supported-hardware guidance, see [README.md](README.md).

## v0.59.14

- Simplified the Industrial Control Centre login's decorative pyramid background: removed the competing full-panel square grid, retained a subdued isometric calibration grid clipped to the diamond build plate, added a smooth static theme-derived glow and restrained part/plate shadows, increased completed-layer visibility, and centred the example layer counter above a slim progress bar driven by actual toolpath completion. Kept the 18-layer nozzle/extrusion alignment, automatic login-only motion, accessibility, responsive layouts, authentication/RBAC and printer behaviour unchanged.

## v0.59.13

- Redesigned the signed-out and first-administrator setup screen as a theme-aware Industrial Control Centre with split desktop branding, the original Stacked Layers sidebar logo, a genuine 18-tier stepped pyramid assembled layer by layer in a 45-degree isometric projection, a diagonal build-bed grid, decreasing blue extrusion perimeters with connected front faces, and a small amber nozzle aligned precisely to the active deposited contour, compact laptop/mobile motion treatments, and an accessible password-visibility control. Removed the `PYRAMID BUILD · DEMO` heading from the illustration while retaining the standalone example layer counter; no real printer telemetry is displayed before sign-in. Made the gentle login printer animation start automatically even when Windows or Chrome reports reduced motion, without any browser configuration or first-visit click. Removed the animation pause button and its stored preference, and retained the frameless bed visual to avoid misleading printer-gantry collisions. No other controller animations override accessibility preferences. The existing authentication, RBAC and HTTP warning behaviour is unchanged.

## v0.59.12

- Refined Operator RBAC: retained queue operations, Print Library editing and printer filament/nozzle assignments, while restricting permanent library deletion, queue-history purge and central filament cost catalogue changes to Administrators; applied the same visibility rules to Preact and fallback UI.
- Fixed first-run authentication blocking the controller HTML shell and static assets: the administrator setup and login GUI remain accessible while all protected APIs and simulator endpoints stay locked until enrollment.
- Introduced **default-on native user authentication**, including HTTP deployments, backed by the account/scrypt and revocable-session primitives, with code-verified first administrator enrollment through the Security & users GUI and offline local disaster recovery. A private one-time code is read from protected startup logs, not a public browser endpoint, and successful enrollment activates a durable security marker immediately.
- Implemented **server-side RBAC** for Administrator, Operator and Viewer before controller and emulator API dispatch, covering printer commands, uploads, backups/restores, camera streams, SSE and sensitive integration/diagnostics endpoints. Unknown API routes fail closed when access control is enabled.
- Added a themed sign-in experience, top-bar identity/account controls, password change and a routed **Security & users** screen for administrators to create, disable, change roles and reset passwords.
- Added Origin and CSRF validation for mutations, credential throttling, secure cookies for configured HTTPS origins, session revocation on role/password changes and logout, and tests for role enforcement, bootstrap, expiry, disabled users and session persistence boundaries.
- **Deployment security:** Installations require administrator enrollment before printer API access, even on HTTP, using a private one-time code and visible interception warning. HTTP login works by default but **does not encrypt passwords or sessions**. `PFC_AUTH_REQUIRED=0` opts into insecure legacy mode only before enrollment; `PFC_AUTH_ALLOW_HTTP=0` requires HTTPS for credentials. Controller transport is **not production-secure until TLS termination and prevention of direct HTTP bypass** are configured and validated. This feature-branch candidate still requires full browser, container/K3s, SEA and end-to-end verification.

## v0.59.11

- Established the **native authentication and role-based access control (RBAC) foundation** with explicit Administrator, Operator and Viewer permission mappings for controller HTTP API methods, protected file and backup operations, print controls, camera streams and live telemetry. Unknown API routes are denied by the proposed policy.
- Added **isolated security primitives** for local accounts: password hashing using Node.js built-in scrypt with individual salts, persistently stored user roles/status, initial administrator creation, and protection against disabling the final enabled administrator. Added random opaque, revocable session tokens with expiry and login-attempt throttling.
- Added security unit/regression coverage for API route/role classification, salted hashes, account persistence and corruption handling, privileged account continuity, session expiry/revocation and login attempt throttling. Documented first-run enrollment, migration, session/CSRF protection, RBAC enforcement and TLS rollout requirements in `docs/AUTHENTICATION_AND_RBAC.md`.
- **Security scope:** These primitives are intentionally **not connected to the production HTTP router**. This release does **not** introduce a login screen, enable user authentication or enforce access control on controller requests. Existing HTTP/LAN behavior is unchanged; HTTPS via MetalLB and Ultimate Certificate Manager is planned separately.

## v0.59.10

- Adopted an audited **Node.js 24.22.1** and **npm 12.2.0** development/build baseline; recorded the required npm version in `package.json`.
- Committed `package-lock.json` and switched GitHub Actions and container dependency installation to **`npm ci`** for reproducible dependency resolution. Production uses the Node.js runtime without an npm process.
- Added npm supply-chain guardrails: a seven-day minimum dependency publication age, disabled unapproved Git/remote dependency sources, and kept the esbuild install-script approval explicit. Routine/urgent update procedure documented in `docs/dependency-security.md`.
- Added CI vulnerability scanning at high severity and above, Dependabot proposals for npm, Docker images and GitHub Actions, and reduced workflow token permissions to release-only package publishing. Tested the Windows x64 SEA build using the patched Node/npm baseline and retained Chromium, Node, MinIO and disposable container regression gates.
- Updated local-security regression tests to tolerate GitHub-only configuration files being absent from distributed Windows source directories while enforcing them in GitHub Actions. No changes to printer protocols, queue commands, licensing, stored data or interface behaviour.

## v0.59.9

- Standardised **all four Analytics tables** to the shared `--pfc-table-*` controller visual style, extending existing table header, row, border, hover and surface treatments to **Printers needing attention** and **Print file failure analysis** in dark and light themes. Kept the printer-name header cell aligned with ordinary table cells.
- In **Most popular print files**, separated **Material** and **Cost** into distinct, independently sortable columns rather than stacking the values in one column, making eight columns. Retained correct alignment, saved historical costs and currencies, missing/partial values, thumbnails, links and internal mobile table scrolling. Updated Preact and HTML fallback views.
- Standardised the **Top 10 / All files** and **By material type / By filament** grouped choice buttons to the established 42px controller control height, semantic blue selected state, muted unselected state and visible keyboard focus. These remain mutually exclusive choices with `role="group"` and `aria-pressed`, not binary switches.
- Updated the standalone Controller Visual Style Guide and expanded Node/Chromium visual, DOM, responsive and selection regression coverage. No changes to printer control, job history, or analytics aggregation.

## v0.59.8

- Applied the controller's established `--pfc-table-*` table design system to Reports & finance → Analytics → **Material usage**, in both **By material type** and **By filament** presentations. Use matching dark header/white uppercase text, shared panel borders and radius, compact cell padding, horizontal dividers, hover highlighting and light/dark theme appearance.
- Standardised the bold Material usage **Total** row on the shared surface with a consistent separator. Preserve column alignment, per-row quantity, percentage usage progress bars, saved historical costs/currencies, grouping switch and both Preact and no-bundle HTML rendering.
- Updated the standalone `docs/CONTROLLER_VISUAL_STYLE_GUIDE.md` to document the coverage; added Node regression assertions and Chromium computed-style comparisons for both themes and grouping modes, leaving printers, queue scheduling, reporting aggregation and underlying data untouched.

## v0.59.7

- Restyled the Dashboard's four summary filters to match Reports & finance → Analytics Option D: outlined circular SVG printer/connectivity/printing/attention icons, themed blue/green/cyan/amber accents and matching headings, counts and slim bars. Rings for Online, Printing and Needs attention show measured shares of the selected printer group, while All Printers remains a neutral total; a healthy zero-attention state shows a green check. With zero printers, the UI avoids invented ratios.
- Kept every summary card's label, count, contextual description and progress indicator **beside its circular icon**, not below it. Corrected the late-loaded Dashboard polish rule that overrode horizontal positioning. Works in Preact and the legacy fallback, with 2-column desktop/mobile layouts, preserving filter clicks, active states and theme styling.
- Removed the large blank band between the printer image and print-job information by eliminating inherited parent subgrid row gaps across hidden card status sections. Whole printer tiles still have distinct spacing. Model images remain aspect-ratio-preserving and have increased bottom clearance to avoid lower-edge clipping/overlap. Dashboard table view unaffected.
- Expanded Node.js and Chromium regressions for measured KPI indicators, icon/text alignment at narrow viewports, printer image and body proximity, subgrid image baseline consistency and desktop/mobile card spacing; container smoke tests passed before the release metadata update.
- Established a standalone, detailed **Controller Visual Style Guide & Icon Catalogue** in `docs/CONTROLLER_VISUAL_STYLE_GUIDE.md`, plus a locally stored visual reference of 42 current/proposed outline icon designs (`docs/assets/controller-icon-catalog.svg`). The guide covers colours, type, spacing, tables, switches, buttons, tabs, forms, KPI cards, printer tiles, themes, accessibility and responsive UI. It is intentionally separate from the README and project context.

## v0.59.6

- Replaced the redundant **Popularity** column in Reports & finance → Analytics → Most popular print files with **Material / cost** (material kilograms plus historical filament spend displayed on separate lines) and **Print time** (total recorded printer run duration). Material and cost relate to completed prints; runtime also includes recorded failed and started-cancelled physical attempts. Original file rankings, success-rate calculations, thumbnails, links and Top 10/All selection are preserved.
- Added sorting by total material consumption, historical filament cost (only comparable within the same recorded currency) and total printer time. Missing data shows `—`; partially captured historical material, cost and duration records are explicitly marked **partial**. Currency amounts are never silently converted.
- Matched Most popular print files to the controller's standard Dashboard / Alerts / Printer Groups table styling: shared header typography/background, panel border/radius, row dividers and hover colours in light and dark modes, preserving sortable controls and resource metrics.
- Added a scrollable bottom gutter beneath the final Print file failure analysis card (32px desktop, 24px mobile), limited to the Analytics tab so card borders and other Reports & finance pages remain unaffected.
- Expanded reporting-service, Preact and legacy UI, and Chromium responsive-layout regression tests for resource aggregation, data completeness, sorting and page bottom clearance. Printer scheduling, library pricing and historical job snapshots remain unchanged.

## v0.59.5

- Added directional **vs previous period** indicators to the four Option D headline cards on Reports & finance → Analytics. The reporting API compares the selected date range with the immediately preceding, adjacent range of equal length, applying the same printer/group filters. Completion increases and failure reductions show favourable green; the reverse shows red; total jobs and run time use neutral blue. Unchanged values, missing earlier data and zero-baseline changes are handled explicitly without misleading percentages.
- Updated the four headline cards with larger matched outline SVG icons, semantic progress rings and slim bars. Completed and failed meters display their true measured percentages. Total jobs and run time display decorative neutral indicators, not fictional 0–100% targets. Responsive light/dark styling and accessible meter labels are retained.
- Fixed sparse **Print outcomes over time** visualisation: include zero-activity calendar days for the selected period, plot visible labelled markers for days with completed/failed/cancelled prints, and remove duplicated Y-axis counts for small totals. Works in both Preact and fallback views.
- Clarified Material usage → By filament when only a material name is saved: **PLA (Unidentified filament)** if no catalogue reference was recorded, or **PLA (Brand/product not recorded)** when a reference exists without its brand/product. Explanatory tooltips distinguish the cases. Historical prints, material snapshots, currency and costs are unchanged.
- Expanded reporting service/UI regression cases for adjacent filtered ranges, baseline/no-data rules, theme-specific card visuals and sparse chart rendering; validated with Node.js, Chromium Preact and container smoke tests.

## v0.59.4

- Redesigned **Reports & finance → Analytics** with four production headline statistics and coloured icons: blue for neutral activity/runtime, green for completions or zero failures, and red for recorded failures. Moved the full-width print-outcomes timeline directly under the stats.
- Replaced the popular print file bars with a full-width sortable table: previews, file detail links, completed/failed counts, success rate, popularity indicators and Top 10/All toggle. Fixed the constrained 365px table viewport, sized desktop columns across the card and retained responsive horizontal scrolling only on narrow screens.
- Reworked material usage as grouped tables (by material type or by filament) showing kilograms, share and historical cost without modifying data collection. Added print file failure analysis with latest failures.
- Corrected printer attention analytics so healthy printers are excluded and unassigned automatic queue jobs are never treated as actual printers. Missing trend data reads “Insufficient data”; short or unknown runtime is displayed accurately.
- Added Node.js and Chromium Preact/browser regression coverage for analytics totals, trends, table grouping/sorting, desktop geometry, theme-aware icons and compatibility with legacy rendering. Printer dispatch, pricing and historical costs are unchanged.

## v0.59.3

- Centralised currency selection under **Reports & finance → Price settings** and removed the per-filament currency selector from Filament cost catalogue. Current prices and rates (filament, sundries, labour, hourly print time, Print Library selling prices) use the same global currency, with validation against the existing supported currency list.
- Existing single-currency filament catalogues supply the initial currency when the new setting is missing; otherwise GBP is the default. Current catalogue records and estimates inherit the global selection, including formerly mixed-currency entries. No automatic FX conversion is attempted; the interface warns users to review costs and hourly rates after changing the currency.
- Historical completed-print cost snapshots and Reports history retain the actual currency and amounts recorded at print time; they are never retrospectively relabelled or converted. Existing pricing clients omitting currency on PUT preserve the current selection. Added catalogue, pricing, migration, UI and browser checks for global selection.


- Print Library sundry dropdown: **Labour** now asks for **Labour minutes** in the Add file and Edit details windows, hiding the normal quantity and unit-cost inputs. Minutes are validated and stored per file/print, not per sale lot.
- Added a global **Labour hourly rate** to Reports & finance → Price settings, separate from the existing hourly machine print cost. Labour cost is computed as minutes × rate ÷ 60 using the current filament currency, added to sundries before profit, tax and sale-lot rounding. Selling prices refresh when the rate changes.
- A missing labour rate prevents a misleading completed sell price for files containing minutes-based Labour. A deliberate zero rate is allowed. Existing fixed-cost Labour lines remain unchanged until manually converted by entering minutes, preserving legacy data and backups.
- Added backend validation, legacy compatibility and pricing tests, and UI plus Chromium add/edit/hourly-rate regression coverage.

## v0.59.2

- Reorganised the Print Library toolbar so Search, Add file and all four selected-file actions (Queue, Edit details, Favourite, Delete selected) appear together on one line where the desktop width allows. Kept selection status visible below the controls, preserved button IDs/disabled states and keyboard/accessibility behaviour, and made the action group wrap safely on narrow screens. Expanded Node and Chromium desktop/mobile layout regression tests.
- Reduced Print Library desktop content/table width from 1500px to 1300px and constrained it to the available sidebar-adjusted workspace width, removing unnecessary horizontal spread.
- Tightened Min. sell price and History grid tracks and column spacing. Kept all nine columns, their header/row alignment, sorting, sticky controls and full pricing details intact.
- Switched to responsive file cards below 1351px viewport width, before the table could clip or create horizontal scrolling. Added Node regression assertions and Chromium layout checks across desktop and mobile viewports.
- Version advanced to 0.59.2. Print Library calculations and printer/queue behaviour unchanged.

## v0.59.1

- All six routes under the sidebar's **FARM MANAGEMENT** section now show **Farm management** in the very top bar instead of repeating the page title (Maintenance, Printer groups, Reports & finance, Alerts & notifications, Backup & recovery, Diagnostics). Their contextual subtitles and individual blue content headings remain unchanged. Dashboard, Queue & history, Print library and footer Licence retain their existing topbar names. Deep links, sidebar routing and mobile navigation retain their behaviour.
- Print Library **Ready now** readiness considers correctly loaded, online matching printers that are currently printing (busy or reserved), rather than showing **Needs attention** because another idle printer has the wrong filament. Tool, nozzle and material mismatches still block readiness; the tooltip explains that the job will start after the eligible printer becomes idle and passes live queue preflight. Queue scheduling/safety enforcement is unchanged.
- Renamed the Print Library table's **Sell price** column to **Min. sell price** (meaning minimum sell price). Applied the same label to narrow-screen cards and the sort menu; the header retains a full accessible label. Existing pricing calculations, sale-lot allocation, tax and sorting behaviour are unchanged.
- Renamed the blue category headings on Print library to **FARM FILE LIBRARY**, Backup & recovery to **FARM PROTECTION**, and Diagnostics to **FARM CONTROLLER DIAGNOSTICS**, without changing the functional page titles, routes or Add/Edit file dialog labels.
- Removed the redundant workspace breadcrumbs from every page of the controller, including the static/no-Preact fallback. Removed the unused Preact trail component and its route-event wiring; standard sidebar navigation, current-page highlighting, keyboard focus and browser back/forward remain intact.
- Kept the existing top-bar route title and subtitle, the blue shared page heading, page descriptions, navigation tabs and page actions. Reduced the desktop top bar to 64px, with a compact 60px mobile minimum, and standardised the main content top gap to 18px on desktop / 16px on mobile.
- Updated Node.js regression checks and real-browser Chromium route, theme, desktop/mobile and layout assertions to enforce the breadcrumb-free shell, including deep links and browser history.
- Increased version from **0.59.0** to **0.59.1**.

## v0.59.0

- Added a global **Hourly print cost rate** in **Reports & finance → Pricing settings**, accepting non-negative currency rates with 0.01 increments. Saved settings from earlier releases default to **0.00**, preserving existing quotes until changed.
- **Print Library Sell price** now incorporates **slicer-estimated print duration × hourly cost rate** in each print's cost base, alongside current filament and sundry costs. Existing markup/gross margin, tax calculation, per-sale-lot allocation and currency-aware rounding remain unchanged.
- The computed print-time charge appears beneath the Sell price in Preact and vanilla fallback views, with a detailed cost breakdown on hover. As with sundries, the hourly rate uses the filament estimate's currency and performs no FX conversion.
- When the hourly rate is nonzero and the sliced file has no reliable estimated print duration, a Sell price is marked **Unavailable** with a reason rather than omitting the operating cost.
- Pricing settings remain part of portable backup/restore. Added regression coverage for persistence, missing-duration behaviour, markup/margin and tax pricing, UI wiring and backup round-tripping. Historical print-job cost snapshots and printer command logic are unchanged.
- Increased version from **0.58.1** to **0.59.0**.

## v0.58.1

- Renamed **Reports & costing** to **Reports & finance** in navigation, screen title, route breadcrumb/top-bar labels and accessibility descriptions. The existing `/reports` route and the three Analytics, Filament cost catalogue and Pricing settings tabs remain unchanged.
- Added a global **Tax rate (%)** to Reports & finance → Pricing settings, validated from 0–100%. Tax is applied **after** the profit markup/gross-margin calculation, before allocating tax-inclusive selling price across sale lots. Existing pricing settings and restored backups default to **0% tax** until changed.
- Added separate, sortable **Sale lots** and **Sell price** columns to the Print Library table (including Preact, fallback and responsive cards). Sell price replaces Suggested sell price and shows the **tax-inclusive per-lot price** for multi-lot prints, or the whole-print price for a single lot. Multi-lot entries also show their full-print total. Pricing remains unavailable when required filament costing/global profit settings are missing; no automatic currency conversion.
- Standardised sundry item selection in Add File and Edit Details to the five categories **Packaging, Postage, Hardware, Labour, Miscellaneous**, using a dropdown. Saved legacy custom sundry labels are retained as a selectable historical value until deliberately changed.
- Display sundry unit costs with **two decimal places**, 0.01 input steps and formatting on field exit. Styled the per-item **Remove** action as an outlined red danger button; only Save persists changes and Cancel leaves stored sundry items intact.
- Added Node.js and Chromium regression checks for tax arithmetic/rounding and persistence, table columns/sorting/alignment, sundry dropdown options, removal/cancel behaviour and currency precision. Historical print-job cost snapshots, printer protocols and dispatch safety are unchanged.
- Increased the version from **0.58.0** to **0.58.1**.

## v0.58.0

- Extended **Add file to Print Library** to capture category and tags at upload, in addition to printer target and notes. Existing Print Library files can still be updated using Edit details.
- Added **sundry costs** for each sliced print: multiple labelled line items with quantity and unit price (e.g. hardware, threaded inserts and packaging), editable when adding a file or later.
- Added **Sale lots per print** (1–999) to allocate the selling price for a single sliced print across individually saleable products.
- Added **global profit percentage and method**—markup on production cost or gross profit margin—on a new **Pricing settings** tab beside Analytics and Filament cost catalogue. Renamed the overall page to **Reports & costing**, updating sidebar, headers, breadcrumbs and accessibility labels.
- Calculates suggested total-print and per-lot selling prices from complete current filament costs plus all sundries. Each lot is rounded using currency-specific minor units and the quoted batch total is the sum of its lots. Without filament cost coverage or configured global profit, a price is withheld.
- **Sundry currency is automatically inherited from the completed filament cost**, rather than configured separately per library file. Previously saved manual currency values are ignored and removed on subsequent metadata edits; no foreign-exchange conversion is assumed.
- Refined Add/Edit dialog layout to follow the shared Preact design system: readable section headings, standard inputs and panel styling, with fixed header and Save/Cancel footer and independently scrolling body.
- Global profit settings are stored in the controller data directory and included in backup and restore, with safe defaults for older backups. Existing print history/queue cost snapshots and printer compatibility/dispatch logic are unchanged.
- Added unit tests, API/data persistence and backup tests, plus Chromium regression coverage for pricing, currencies, lots, report tabs and dialog layout.
- Increased version to **0.58.0**.

## v0.57.2

- Made Print Library **readiness/status badges clickable** to filter the visible files by Ready now, Printer busy, Printer offline, Needs attention or Incompatible. Shows the matching selection in Advanced Filters, combines it with other active search/facets, resets pagination, and supports accessible keyboard activation in both Preact and fallback UI while keeping status colours and diagnostic tooltips.
- Preserved the Print Library's **current scroll position when selecting or deselecting a file** with a row click, selection button or keyboard. Deliberate filtering, sorting and page changes continue to reset to the first result.
- Fixed **Ascending/Descending button alignment** with the Sort by selector and Batch quantity field by removing the global label margin only within the Print Library sort controls. Maintained standard 42px control heights and light/dark styling.
- Added Node.js regression contracts and Chromium tests for status filtering, mouse/keyboard selection without scroll jump and sort-control geometry. No printer protocol, queuing, dispatch or compatibility safety changes.
- Increased patch version from v0.57.1 to v0.57.2.

## v0.57.1

- Corrected the Print Library **Printer** advanced filter to show readable manufacturer/model labels rather than internal adapter-type identifiers, while preserving matching keys and existing filter data.
- Fixed misleading **Incompatible** explanations for designated printer models: use the matching printer's actual incompatibility reason (such as Snapmaker U1 not supporting direct `.3mf` uploads) instead of a different printer's designation mismatch, or clearly state when the targeted model is not configured. Queue compatibility and upload formats remain enforced.
- Made per-file **category and tag badges clickable** to immediately filter the Print Library. The selected facet appears in Advanced Filters, other filters remain active, result paging restarts at page one, and accessible keyboard interactions work in both Preact and fallback renderers.
- Added regression coverage for filter labels/keys, designated-printer readiness messages and clickable category/tag interactions; no printer protocol or scheduling safety changes.
- Increased patch version from v0.57.0 to v0.57.1.

## v0.57.0

- Redesigned the **Print Library** as a selected-file production workbench with a central **Queue selected / Edit details / Delete selected** action toolbar, independent thumbnail previews, printer/material/requirements/cost/history columns and one selected file at a time. Reused the shared controller table skin, white uppercase headers, blue selection and consistent light/dark colours, with responsive mobile cards.
- Kept the page title, search/add controls, contextual buttons and desktop column headings visible while the **file rows alone scroll** inside a viewport-aware region. Fixed column alignment with native scrollbars and retained keyboard selection and accessible interaction.
- Added **current estimated raw-filament cost per print** based on reliable sliced filament weights, explicit assignment or unambiguous filament catalogue matching. Distinguishes unavailable/partial/multi-currency data from known zero costs, supports a 1–999 quantity raw-material cost estimate and never overwrites historical queue cost snapshots.
- Added **sorting and advanced filters** for name, printer, material, estimated cost, date, print count, time, weight, category, tags, favourites and readiness. Added persistent category/tags/favourite metadata, a selected-file favourite action and batch estimate quantity controls.
- Exposed slicer-derived **estimated duration and material weight** when reliably available, with an explicit unknown state otherwise. Added a read-only **printer readiness** preview using existing queue compatibility rules and verified live telemetry; separated genuinely incompatible/needs-attention files from temporarily **Printer offline** and **Printer busy** states. Status-only updates while viewing the library are throttled via existing fleet SSE and a lightweight endpoint, preserving selection, filtering, page and scroll state. Actual queue preflight remains authoritative.
- Bounded large-library rendering to **80-file pages** with efficient metadata and queue-history lookups. Added Node.js 24 regression tests and Chromium Preact tests for the new UI, live readiness, costing, metadata persistence, keyboard and mobile interactions, long-list scrolling, both colour themes and container smoke. No printer-control protocol, scheduler safety gate or licence-limit changes.
- Increased source release from v0.56.0 to v0.57.0.

## v0.56.0

- Adopted **Phase 4.1 standard tab navigation** throughout Printer Details, Maintenance Tracking, Printer Groups, Reports & Analytics, Alerts & Notifications and Backup & Recovery: icons, selected blue underline and matching text, transparent background, focus outlines and one-row horizontally scrolling navigation on narrow screens.
- Created a reusable `UiTab` Preact component in the shared design system and loaded a single last-applied `public/tab-navigation.css` stylesheet. Maintained identical styling for legacy/no-bundle fallbacks with tab-level `data-pfc-tabs` and `data-pfc-icon` contracts.
- Extended the **Printer Details identity header** with existing local model imagery and six icon-labelled live data fields (model, connection, host/IP, uptime when actually reported, firmware when reported and connection health). Preserved current status, maintenance actions, connectivity/latency diagnostics, existing printer controls and all six tabs. Shortened two visible tab labels without changing their full accessible names.
- Preserved all printer protocols, toolhead filament/nozzle widths and alignment, queue/report/backup actions, route switching, management forms and dashboard card/table view toggle.
- Added Node.js structure/regression checks plus Chromium checks for shared tab styling, accessibility, keyboard navigation, mobile scroll and both colour themes. User reviewed the feature changes on PRs #99 and #100; all feature-branch Node.js 24, Chromium, MinIO integration and container smoke gates passed.
- Increased source release from v0.55.0 to v0.56.0.

## v0.55.0

- Completed **Phase 4 of the polished SaaS migration** with a redesigned Printer Details modal: clearer printer name/model/host identification, live status, maintenance/health context, theme-aware dialog and tab/section surfaces.
- Improved usability on desktop and Android-sized viewports with a single horizontally scrollable tab rail, accessible selected/focus indicators, labelled tab panels in Preact and vanilla fallback, maintained arrow/Home/End keyboard navigation and a 44px close touch target.
- Preserved all six Printer Details sections, printer API/protocol behaviour, stateful controls and telemetry, management drafts, Bambu spool/AMS and multi-tool configurations, calibrated 160px material/nozzle input alignment and no-bundle fallback.
- Added regression contracts and Chromium desktop/mobile light/dark, keyboard, ARIA and layout coverage. Node.js 24 tests, Chromium Preact and container smoke checks passed on PR #98; physical-printer checks remain a separate ongoing hardware validation activity.
- Raised controller source version from v0.54.0 to v0.55.0.

## v0.54.0

- Introduced a cohesive **Preact SaaS-style design system** with a shared `--ds-*` theme-token layer, consistent typography/spacing, reusable surfaces, button busy indicators, inline messages, field controls, empty states and loading placeholders. Preserved local-first operation without CDN dependencies, existing API contracts and no-bundle fallback.
- Redesigned the **application shell** with grouped, SVG-icon sidebar navigation, desktop and mobile layouts, accessible keyboard-driven mobile drawer, backdrop dismissal, focus management and a route-aware Preact breadcrumb. Corrected the Dashboard header so the title, breadcrumb and subtitle do not repeat or overwrite each other.
- Refined **dashboard layout and information hierarchy**: Farm overview, contextual status summary cards, group/card-table controls, live Printers heading, and themed printer-card metric/progress/action treatments. Preserved sorting, queue/maintenance actions, filament swatches, existing controls and printer-card/table mode switching.
- Standardised **page headings** across controller routes and updated the Printer Groups category heading to **Farm Organisation**. Fixed card-view printer image misalignment caused by wrapped model/name text via shared CSS subgrid tracks, and widened the table-view status column so the OFFLINE pill, coloured dot and maintenance icon fit properly.
- Added Node.js unit/contract tests and real Chromium browser checks for desktop/mobile, dark/light, reduced motion, navigation/keyboard accessibility, page-heading consistency, table-status visibility and image alignment. Optional visual screenshots are uploaded using the Node.js 24-capable GitHub `actions/upload-artifact@v7`; local installation tests tolerate missing GitHub workflow metadata. GitHub Actions checks passed on PR #96.
- No changes to printer protocols, scheduler, licensing, queue semantics or authoritative telemetry. Mainline source release bumped from v0.53.0 to v0.54.0.

## v0.53.0

- Extended **Bambu A1 Mini external-spool filament editing** with the same filament type, colour and blue **Set filament** controls already available for the P1P/P1S/X1C, using printer-side LAN MQTT `ams_filament_setting` on the external virtual tray (AMS 255, tray 254) and verified printer read-back.
- Enabled **AMS Lite individual slot filament configuration** on the A1 Mini for occupied slots explicitly reported as non-RFID. Preserved read-only protections for RFID-managed, missing/unknown RFID-tag and empty slots, as well as idle-only writes, per-slot targeting, and verification of printer-reported material and colour. The printer remains the authoritative source; other AMS Lite slots and the external spool are not modified by a slot change.
- Kept A1 Mini-specific 80 °C bed limit, TLS/JPEG camera and lack of chamber controls. Added AMS Lite filament-handling compatibility guidance without applying the same material restrictions to the external spool.
- Extended virtual A1 Mini TLS MQTT end-to-end tests for standalone external-spool usage, AMS Lite updates, RFID/empty slot safety, busy-state rejection and unaffected material sources. PR #95 Node.js 24, Chromium Preact and container smoke tests passed. **Physical A1 Mini and AMS Lite hardware/firmware validation is still required**, and support remains experimental.

## v0.52.0

- Added optional **Bambu P1P/P1S/X1 Carbon AMS slot filament configuration** in Printer Details → Toolheads. Occupied, explicitly identified third-party/non-RFID slots expose filament type and colour dropdowns and the standard blue **Set filament** button, in both Preact and the legacy frontend.
- Changes are sent to the selected AMS unit and slot via LAN MQTT `ams_filament_setting`, and are confirmed only when the printer reports the updated values. Other slots and the external spool are unaffected; printer telemetry remains authoritative for display and scheduling.
- The controller allows AMS edits only while idle and fails closed for RFID-managed filament, unoccupied slots and missing/unknown RFID identity. A1 Mini AMS Lite editing remains disabled; X1 Carbon H.264 camera support is unchanged.
- Added simulator RFID-managed toggles and regression coverage for multiple AMS units, slot addressing, blocked writes and UI behaviour. Stage 2 was tested with virtual printers; GitHub Actions Node.js 24, Chromium Preact, container smoke and container build checks passed on PR #94. **Real Bambu AMS hardware and firmware validation remains outstanding.**

## v0.51.0

- Extended experimental **Bambu X1 Carbon (X1C) external-spool filament type and colour configuration** to use the same Printer Details → Toolheads dropdowns and blue **Set filament** button as the P1P/P1S. Preact and legacy fallback retain the established layout.
- X1C now supports printer-side idle-only `ams_filament_setting` MQTT writes targeting the external virtual tray (254) with read-back verification; AMS slots remain printer-reported and are not modified. The X1C camera remains unsupported, and the A1 Mini is unchanged.
- Extended virtual X1C TLS MQTT integration and UI/safety regressions, including verifying that busy printers reject updates and AMS slot data remains unaffected. The final PR #93 Node.js 24 / Chromium Preact / container CI checks passed, and the virtual X1 Carbon was user-tested. Physical X1C hardware and firmware validation remain outstanding.

## v0.50.0

- Added **Bambu Lab P1P / P1S external-spool filament configuration** in Printer Details, with selectable material type and colour, using the same blue **Set filament** button styling as other printers. This is a printer-side write via the Bambu LAN MQTT `ams_filament_setting` command addressed to virtual tray 254, rather than a controller-only designation.
- Requires the printer to be idle, preserves applicable existing filament preset information when changing only the colour, and checks reported external-spool telemetry before confirming success. AMS/AMS Lite slots remain untouched. X1C and A1 Mini external-spool editing is not enabled by this release.
- Added Bambu MQTT simulator support and regression tests for write payloads, validation, idle-state protection, read-back verification, Preact/legacy UI consistency, and AMS isolation. Automated Node.js 24, Chromium Preact and container smoke tests passed on the feature PR; physical P1P/P1S validation is still required.

## v0.49.0

- Vertically aligns the **Set filament** and **Assign** buttons for Flashforge AD5M and AD5M Pro Toolheads. The Preact filament editor previously inherited an extra 8px label-bottom margin and 6px material-select margin from legacy designation CSS, while the nozzle editor used zero and 4px. Normalising these in the inline form keeps fields and buttons on the same row; Chromium regression compares the actual button and field positions using the shared AD5M/Pro adapter simulator.

- Aligns the guidance below **Assign** with the guidance below **Set filament** in the CORE One+ and Creator 5 / Creator 5 Pro Toolheads rows. A generic nozzle-designation helper margin had shifted the Preact nozzle text 13px lower; both Preact editors now use the same helper top margin. Browser regression checks actual button and text positions for CORE One+ Standard/INDX4/INDX8 and Creator 5/Pro, without altering the legacy fallback.

- CORE One+ **Installed tool system** changes now immediately rebuild the open Toolheads panel (Standard ⇄ INDX4 ⇄ INDX8), without closing the dialog. Since PrusaLink telemetry is polled asynchronously after the saved controller change, the UI temporarily fills newly configured tool slots with unknown live values rather than retaining the old tool count; the next telemetry publication supplies the actual readings. Preact editors and legacy rendering share the same configured-tool display, while controller assignment/firmware operations remain unchanged. Chromium regression verifies 1→4→8→1 without closing the dialog.

- Displays **Prusa CORE One+ Standard (single toolhead)** using the same full-width Toolheads table as INDX and other supported printers. Filament type/colour and the controller nozzle designation/Assign control now occupy the same T0 row under separate Filament configuration and Nozzle headings. Correctly selects the single-nozzle designation control rather than the multi-tool nozzle handler; no duplicated control below the table. Preserves INDX4/INDX8 and legacy no-bundle functionality. Adds Chromium layout/column geometry regression coverage.

- Aligns filament type, colour and nozzle selection controls directly beneath their Toolheads table headings across U1, Creator 5 / Creator 5 Pro, CORE One+, and AD5M / AD5M Pro. Preact nested editor forms now override the global dialog form padding (22px) inside table cells. Adds real-browser alignment checks for U1 and AD5M Pro and form-padding checks for Prusa, without affecting the legacy fallback or print/device commands.

- Corrects undersized filament type and colour-family selectors on Prusa CORE One+ Toolheads (Standard/INDX4/INDX8). Preact editor forms now span both tracks of the legacy wrapper grid, restoring the shared 160px field widths, consistent with U1, Creator 5 and Flashforge; the no-bundle fallback is unaffected.

- Aligns Flashforge **AD5M and AD5M Pro** Toolheads presentation with the U1-style table. The single T0 row contains its identity, live material information, filament designation controls and nozzle-size selector/Assign button, under the same shared table headers and visual styling. The controls no longer appear as separate blocks below the toolhead. Works with Preact and the legacy frontend fallback; no printer commands or designation APIs change.

- Continues Printer Details Preact migration in **Toolheads** for controller-side filament type/colour-family metadata and nozzle designations: the Prusa per-tool and Flashforge AD5M controller selectors, plus per-tool nozzle designation controls, now use controlled Preact form islands with dirty-state handling, pending/error status, clear where supported and safety-checked API event bridges. Values survive routine status refreshes; original fallback remains. U1 and Creator 5 filament type/colour selection is also now Preact-controlled, but still uses the established printer-side filament-config API for verification. U1's idle, loaded third-party/non-RFID constraints and Creator 5's idle/palette constraints are checked before issuing any write and revalidated by the server. Other hardware commands remain unchanged.

- Starts interactive Preact migration in **Printer Details → Maintenance & Management**: Controller name is now a controlled input with Reset, dirty-state tracking, single-flight rename, inline success/error and licence read-only handling. Controller-owned API and printer cache remain authoritative, while the Remove printer action and device operations stay on the established code paths. Unsaved names survive ordinary telemetry refreshes. The legacy rename form remains available when the Preact bundle is absent.

- Splits Printer Groups into **Create group** and **Existing groups** tabs. Creation has its own membership editor; existing groups are listed with edit/delete actions and an inline editor only when editing. Separate Preact create/edit drafts persist across tab switches, with keyboard tab navigation and equivalent legacy fallback behaviour.
- Begins the interactive Preact migration: Printer Groups creation, editing, overlapping membership selection and deletion now use a Preact-managed form, local draft state and request lifecycle rather than legacy DOM mutations when the frontend bundle is available.
- Introduces shared controlled text and checkbox components, with a bounded-height, independently scrollable printer membership table, sticky column headings, live search, selected/visible counts and select/clear visible controls. The vanilla fallback uses the same scrollable table layout.
- Unifies table headers, typography, background, borders, dividers and hover treatments using shared dark/light CSS tokens across Dashboard table view, Alerts history, Printer Groups membership, Diagnostics renderer status and multi-toolhead configuration tables. Preserves each table's column layout and small-screen behavior.
- Keeps printer-group API enforcement, queue/dashboard group choices and backend scheduling unchanged; a narrow bridge refreshes the existing application cache after successful Preact mutations.
- Extends the real Chromium suite to check unsaved drafts during state publications, create/edit/delete requests, error retention and absence of duplicate submissions using an isolated API fixture.
- **Development branch milestone:** follow-up review and browser validation are required before merging or shipping.

## v0.48.1

- Completes a validity audit of the regression suite, adding a dependency-free `npm run test:audit` inventory and strengthening tests for queue scheduling and fairness, bed-clearance interactions, printer-operation conflicts, recovery/rollback protection and signed-licence enforcement.
- Adds `npm run test:browser` with a dedicated real-Chromium GitHub Actions job to verify all ten direct routes and browser refreshes, Reports data loading, navigation history, Preact initialisation without legacy fallbacks, live presentation updates and one-click queue clearance requests.
- Tests the live controller SSE path end-to-end using an isolated simulated Snapmaker U1: protocol status polling, `/api/events` delivery and in-place Preact printer-card updates. These tests do not claim physical printer firmware validation.
- Removes six obsolete/redundant source-only test cases and two repeated assertions after replacing their coverage with behavioural tests; retains the legacy renderer, printer-model UI and packaging contracts.
- Keeps the runtime controller features unchanged. The regression suite, browser tests and container smoke checks now form separate CI quality gates.

## v0.48.0

- Standardises the **Set filament** and nozzle **Assign** button labels, primary-blue styling and shared dimensions across Snapmaker U1, Prusa CORE One+ (Standard, INDX4 and INDX8), FlashForge Adventurer 5M/5M Pro and Creator 5/Creator 5 Pro.
- Sets all relevant filament-type, filament-colour and nozzle-size selectors and their matching action buttons to a shared **160px width** and **42px height**, aligned to the start of their columns rather than stretched to fill them.
- Groups filament type and colour selectors with a consistent **8px gap**, and keeps the AD5M-series nozzle-size dropdown directly below its designation heading.
- Removes obsolete **Clear** designation/assignment buttons from supported controls, while preserving each printer family's existing write-to-printer or controller-only designation behaviour.
- Expands model-specific UI regression tests for button labels, styling, field sizing, layout and absence of removed actions.

## v0.47.2

- Adds a fallback-safe **Frontend renderers** section under Diagnostics showing the Preact bundle evaluation marker and renderer status of all 13 migrated presentation areas, with a manual Recheck action.
- Reports unexpected use of the legacy JavaScript renderer as a browser-console warning while leaving the fallback operational when the optional Preact bundle is missing.
- Adds Node regression tests for successful, partial and missing Preact initialisation, diagnostics rendering, console warnings, module inclusion and live dashboard event-bridge wiring.
- Keeps the existing intentionally vanilla JavaScript control and specialist form workflows unchanged. Renderer status indicates successful component initialisation, not an end-to-end assertion that every live update rendered correctly.

## v0.47.1

- Fixes blank routed controller pages after using the browser Refresh/Reload button on routes such as Queue & history, Print Library, Maintenance, Printer groups, Reports & analytics, Alerts & notifications, Backup & recovery, Diagnostics and Licence.
- Moves the initial route render until after controller UI state initialization, preventing a startup temporal-dead-zone error on non-dashboard paths while retaining the existing SPA route fallback and in-app navigation behaviour.
- Re-activates the current route after all frontend modules have registered their handlers so direct refresh also runs the route's normal data-loading path; this restores populated Reports filters/KPIs and keeps other routed pages consistent.
- Adds regression coverage for both direct-route startup ordering and routed data loading after module registration.

## v0.47.0

- Introduces the first Preact-based controller UI island while retaining the existing vanilla JavaScript interface as a fallback.
- Migrates the dashboard summary filters, printer-group selector, Cards/Table view switch, printer cards and compact table rows to reusable Preact components.
- Drives printer cards from normalized live view-model state while retaining the established controller command/event delegation for printer actions, selection, sorting, maintenance shortcuts and drag/reorder.
- Adds reusable Preact UI primitives for buttons, status badges, progress bars, metrics and toast notifications, and applies them to the dashboard for more consistent interaction and visual state.
- Adds non-blocking dashboard feedback for pause/resume, chamber-preheat stop and bed-clearance actions while retaining existing error handling.
- Extends the Preact migration into Printer Details: the live printer header, status/maintenance presentation, activity banner and six-tab navigation now use reusable Preact components while the existing toolhead, camera, file, temperature, job and management controls remain on their proven controller logic.
- Preserves the vanilla-JavaScript Printer Details header/tab implementation as the fallback when the optional Preact bundle is unavailable.
- Migrates Print Queue & History list rendering to keyed Preact components for queued jobs, active jobs, bed-clearance interlocks, production batches and recent history while preserving the existing queue scheduler APIs and delegated action handlers.
- Keeps priority and production-quantity edits stable during live queue refreshes and defers Preact queue rerenders while pointer interactions are in progress.
- Migrates Print Library file-card rendering to keyed Preact components for previews, descriptions, printer targets, detected requirements, filament colours, usage metadata and warnings while preserving the existing search, upload, queue, edit, preview and delete controller handlers.
- Retains the vanilla Print Library card renderer as a fallback when the optional Preact bundle is unavailable.
- Migrates Maintenance view tabs and model/group/printer task-card rendering to Preact while preserving the existing maintenance form, APIs, completion/edit/delete/history handlers and vanilla fallback renderer.
- Adds keyboard navigation across Maintenance views and keeps printer-focused maintenance shortcuts compatible with the Preact-rendered cards.
- Migrates Alerts & Notifications tab navigation plus alert-history rows, notification-destination cards and notification-rule cards to Preact while preserving severity filtering, acknowledgement, history clearing, destination forms/tests and rule forms on the existing controller logic.
- Keeps the vanilla Alerts renderer and tab behavior as the fallback when the optional Preact bundle is unavailable.
- Migrates Reports & Analytics tab navigation, KPI cards, outcome chart, printer-attention rows, popular-file/material bars and filament-cost catalogue rows to Preact while retaining reporting filters, calculations, data loading and filament form actions in the existing reporting controller.
- Keeps the vanilla Reports renderers and tab behavior as fallbacks when the optional Preact bundle is unavailable.
- Migrates Backup & Recovery tab navigation, controller backup-status cards and restore-inspection results to Preact while retaining cloud-provider configuration, OAuth/device authorization, backup scheduling, backup creation and restore staging/execution in the existing controller logic.
- Keeps the vanilla Backup & Recovery tab, status and restore-inspection renderers as fallbacks when the optional Preact bundle is unavailable.
- Migrates Printer Groups list/card presentation to Preact while preserving the existing group form, multi-group membership editor, queue/group filter integrations and create/edit/delete controller logic.
- Keeps the vanilla Printer Groups renderer as a fallback when the optional Preact bundle is unavailable.
- Migrates Diagnostics status-summary and log-entry presentation to Preact while retaining refresh, level/search filtering, verbose logging controls and support-bundle download logic in the existing controller.
- Keeps the vanilla Diagnostics status/log renderers as fallbacks when the optional Preact bundle is unavailable.
- Migrates Licence status, entitlement/detail grid, licence-file path and configuration-warning presentation to Preact while retaining licence-file upload, signature verification and activation in the existing controller logic.
- Keeps the vanilla Licence renderer as a fallback when the optional Preact bundle is unavailable.
- Completes the v0.47.0 Preact migration audit: all persistent controller route pages now have Preact presentation coverage, and the dashboard over-limit licence notice is also Preact-rendered.
- Deliberately retains Add Printer/discovery, Farm Operations action forms, Print Library filament-assignment editing, cloud/provider forms and specialist Printer Details controls on the established controller-managed DOM because those areas are tightly coupled to stateful device or form workflows rather than being presentation-only remnants.
- Adds a local esbuild frontend bundle so Preact is packaged with source, container and Windows SEA builds without a CDN or browser-time dependency.
- Keeps Preact and esbuild as build-time development dependencies; a fresh source ZIP uses `npm install --include=dev` once to build the optional Preact asset, while `npm start` itself remains dependency-free and falls back to the existing dashboard if that asset is absent.
- Missing static assets now return HTTP 404 instead of the SPA HTML shell, allowing an absent optional Preact bundle to fail cleanly without disrupting the legacy dashboard.
- Removes the decorative dots from the four dashboard summary-filter headings and restores a consistent vertical label/count layout across all four cards.
- Adds regression coverage for the Preact dashboard integration and packaging paths.

## v0.46.3

- Fixes the dashboard Table view layout when the browser viewport is narrower than the full table width.
- Makes the table header and printer rows use the same 1,528 px minimum width as the combined grid column minimums, preventing the right-hand columns from extending beyond their row/header backgrounds while horizontally scrolling.
- Centralizes the table minimum width in a shared CSS variable so the header and rows remain synchronized.

## v0.46.2

- Adds the controller-style left navigation sidebar to the integrated Printer Simulator.
- Marks **Printer simulator** as the active sidebar destination while providing direct links back to the controller dashboard and routed controller pages.
- Adds responsive mobile sidebar open/close behaviour while leaving the standalone emulator layout unchanged.
- Adds regression coverage for the integrated simulator navigation shell.

## v0.46.1

- Fixes the Print queue & history **Bed cleared · continue** action sometimes requiring multiple presses when live fleet SSE updates redraw the queue between pointer-down and click.
- Defers destructive queue-list DOM replacement while a queue control is actively being pressed, then applies any pending live refresh immediately after the interaction completes.
- Prevents duplicate bed-clearance submissions while confirmation is in progress and shows a temporary **Continuing…** state.
- Re-enables bed-clearance buttons cleanly if the confirmation dialog is cancelled or the request fails.
- Adds regression coverage for queue interaction deferral and bed-clearance action recovery.

## v0.46.0

- Adds a persistent **Cards / Table** dashboard view switch for farms with larger printer counts.
- The compact table keeps live state, current job, progress, temperatures, layer, remaining time, filament colours, last-seen/latency information and printer actions visible in one horizontally scrollable view.
- Preserves the existing dashboard group/status filters and Farm operations selection behavior in table mode.
- Adds clickable table sorting by printer name, status, progress and remaining time with ascending/descending indicators.
- Stores the selected dashboard view in browser local storage so each browser resumes its previous view on the next session.
- Adds regression coverage for the table switch, persistence, compact layout and filtering behavior.

## v0.45.0

- Adds capability-gated **Delete** actions to printer-local Files lists, with confirmation and list refresh after successful deletion.
- Implements printer-local deletion via Snapmaker U1 Moonraker, PrusaLink and experimental Bambu FTPS.
- Keeps the controller Print Library separate from printer-local deletion; FlashForge Adventurer 5M/5M Pro and Creator 5/5 Pro deletion remain unavailable without a validated stock-firmware interface. Physical AD5M Pro testing on firmware 3.2.7-2.2.3 showed TCP M30 acknowledging deletion requests without actually removing the file.
- Adds simulator protocol support and regression tests for file deletion.

## v0.44.0

- Introduces the **Modern Operations UI** with persistent sidebar navigation, routed controller pages, responsive layouts and denser printer dashboard cards.
- Adds consistent semantic action colours across controller workflows, including primary, secondary, positive, attention and destructive actions.
- Adds contextual **Pause / Resume** controls directly to printer dashboard tiles and aligns Current Job controls with the same action styling.
- Improves printer detail usability with clearer action hierarchy, compact printer file rows, and differentiated Queue / Print actions.
- Redesigns **Alert history** as a structured, severity-aware table with improved readability and a confirmed **Clear history** action.
- Reorganizes **Backup & recovery** into dedicated Overview, Google Drive, OneDrive, S3-compatible, Schedule and Restore tabs.
- Preserves the existing printer, queue, maintenance, reporting, alert and backup functionality while moving top-level controller tools into the new navigation model.

## v0.43.0

- Consolidates the **Prusa CORE One+ simulator** into a single printer profile instead of separate Standard, INDX4 and INDX8 entries.
- The unified CORE One+ simulator can be configured as **Standard · 1 tool**, **INDX · 4 tools** or **INDX · 8 tools** when it is created, and the same virtual endpoint can switch between those configurations later.
- PrusaLink simulator telemetry, controller connection settings and simulator recovery now follow the selected 1/4/8-tool configuration without recreating the printer.
- Preserves existing retained tool state for tool indices that remain present when resizing and rejects unsupported tool counts.
- Fixes the **Scan LAN** action in the Add printer window so its label no longer wraps or overflows when the discovery header becomes tight.
- Adds emulator behavior/UI regression coverage plus Add Printer UI coverage for the Scan LAN button sizing fix.

## v0.42.1

- Fixes the **+ Queue file** action in the Print queue & history window so its label no longer wraps or overflows when the section header becomes tight.
- Keeps the shared 42 px button height and standard button typography; the button now simply resists shrinking and stays on one line.
- Adds regression coverage for the Queue file button sizing behavior.

## v0.42.0

- Adds an **Alert history severity filter** with All severities, Information, Warning and Critical views. Filtering is client-side against the loaded history and the selected severity is preserved while alerts refresh or are marked read.
- Changes **Information** alerts to passive history entries. They remain stored and filterable but no longer count as unread, never show a Mark read action, and are ignored by Mark all read. Warning and Critical alerts retain the existing read/acknowledgement workflow.
- Existing stored informational alerts adopt the passive behavior automatically without a data migration.
- Adds backend and UI regression coverage for severity filtering and passive informational alerts.

## v0.41.2

- Standardizes Maintenance tracking terminology on **tasks** throughout the window. Tab headings, section headings, empty states, edit/delete actions, form titles and confirmation messages now consistently refer to model-wide, group-wide and individual-printer maintenance tasks rather than mixing task and rule terminology.
- Adds regression coverage to prevent user-facing maintenance wording from drifting back to rule/rules.

## v0.41.1

- Fixes controller dialog scrollbars visually cutting through the rounded top-right and bottom-right corners. Dialog frames now clip to the shared rounded border while their immediate content containers own scrolling, preserving the existing rounded-corner appearance across controller windows.
- Adds regression coverage for the shared dialog scrollbar-clipping behaviour.

## v0.41.0

- Adds persistent **Farm Alerts & Notifications** with manufacturer-agnostic local alert history, read/unread state, rule matching and scoped delivery by all printers/controller, individual printer, printer group or printer model.
- Adds outbound **ntfy** mobile notifications and generic **webhook** delivery. Notification credentials remain backend-side and API responses expose only redacted configuration state. A real ntfy mobile test has been validated successfully.
- Adds alert events for print completed/failed/cancelled, debounced printer-offline detection, queue jobs needing review, bed-clearance requirements, maintenance due/due-soon, and scheduled backup success/failure.
- Separates alert history from top-bar attention state. Maintenance events continue to appear in alert history and may be delivered remotely but use the existing dedicated maintenance indicator locally; informational alerts such as print/backup completion do not light the general warning triangle.
- Hides the general alert triangle when no unread operational warning/critical alerts require attention, while keeping Alerts & notifications permanently accessible from the overflow menu.
- Persists active alert-condition identities across restarts so continuing offline/maintenance conditions do not create duplicate history entries after an already-read alert. Existing pre-registry history can be adopted safely on restart.
- Includes alert rules, destinations, history and credentials in controller backup/restore with restore validation.
- Reorganizes **Alerts & notifications** into controller-standard tabs for Alert history, Notification destinations and Notification rules, with Alert history as the default tab from every entry point.
- Reorganizes **Reports & analytics** into dedicated Analytics and Filament cost catalogue tabs using the same controller tab component.
- Slightly increases the shared tab-button text size across Maintenance, Printer details, Alerts & notifications and Reports & analytics for improved readability.
- Adds regression coverage for alert persistence, restart deduplication, attention-only top-bar behavior, notification providers, alert/report tab navigation, and responsive/controller-consistent UI behavior.

## v0.40.2

- Corrects Prusa CORE One+ INDX Toolheads vertical alignment by giving the filament material selector the same 4 px label-to-field spacing as the colour and nozzle selectors, so the filament and nozzle dropdown/button rows line up exactly.

## v0.40.1

- Corrects FlashForge Creator 5 / Creator 5 Pro nozzle handling so the four physical toolheads can each carry an independent controller-designated nozzle size. T0-T3 each use the supported 0.25 / 0.4 / 0.6 / 0.8 mm dropdown choices, and queue compatibility consumes the effective nozzle size of the corresponding physical toolhead.
- Existing Creator 5 installations with the earlier single shared nozzle designation are migrated safely by applying that value to T0-T3 while preserving any already-stored per-tool value.
- Adds remote Creator 5 / Creator 5 Pro filament metadata control for each physical T0-T3 slot. The Filament configuration column uses the Creator 5 firmware's exact 21-material and 24-colour palettes, sends `msConfig_cmd` with `{slot, mt, rgb}`, and re-reads `/detail` before reporting success so a silently ignored or palette-coerced command cannot be mistaken for a successful update.
- Presents the Creator 5 / Creator 5 Pro 24-colour firmware palette with the same swatch-based dropdown styling used by other printer filament editors, while retaining the exact Creator 5 colour values underneath.
- Removes the misleading dark left-edge filament-status strip from all multi-tool Toolheads tables, including Snapmaker U1, Creator 5-series and Prusa INDX, while retaining the existing filament-state text treatment.
- Keeps Creator 5 / Creator 5 Pro Toolheads rows compact while restoring the now-useful **Filament configuration** column. Per-tool nozzle controls use compact Assign/Clear actions, and filament type/colour controls sit alongside them without repeating long help text in every tool row.
- Renames the multi-tool table **Configuration** heading to **Filament configuration** on printers where that column is applicable.
- Standardizes controller-managed nozzle action buttons across all supported printer models to the concise **Assign** and **Clear** labels, without changing the underlying assignment or fallback behaviour.
- Standardizes all dropdown-list fields to a shared 42 px control height, including native selects, colour swatch dropdowns and logical-to-physical tool mapping selectors.
- Aligns nozzle-control label typography in Toolheads tables with the **Filament configuration** labels for consistent column styling.
- Aligns Toolheads nozzle selectors with the filament fields using the same 42 px height and 4 px label-to-field spacing.
- Adds the same 6 px field-to-action spacing to Toolheads nozzle controls as the filament configuration controls.
- Standardizes normal primary, secondary and destructive action buttons to a shared 42 px height while retaining compact sizing for dedicated icon/utility controls.
- Updates the shared per-tool nozzle UI and regression coverage so Prusa CORE One+ INDX and Creator 5-series printers use the same controlled per-tool nozzle component without changing their printer-specific behaviour.
- Normalizes helper text beneath multi-tool filament and nozzle controls to one compact 0.68 rem style and short shared baseline wording, adding extra text only for model-specific behaviour such as PrusaLink fallback, U1 write conditions or Creator 5 firmware limitations.

## v0.40.0

- Reorganizes every printer-details dialog into six consistent tabs: **Toolheads**, **Camera**, **Files**, **Temperature, Preheat & Fans**, **Current Job**, and **Maintenance & Management**. The printer-detail tabs reuse the same selector/button component, active-state treatment, Light/Dark styling and responsive behaviour as the main Maintenance screen.
- Adds keyboard-accessible tab navigation and remembers the last selected tab for each printer while the controller page remains open. Unsupported features such as camera or toolhead material status retain a consistent tab and show an explicit unavailable/not-supported message instead of changing the overall layout.
- Multi-tool printers now use a full-width **Toolhead status** table instead of narrow cards in one half of the dialog. Toolhead identity, live information and configuration have dedicated columns; printers with controller-managed manual nozzle assignment also gain a dedicated **Nozzle** column.
- Prusa CORE One+ INDX 4/8 exposes each physical tool's independent nozzle selector in the Nozzle column. FlashForge Creator 5 / Creator 5 Pro expose their existing shared four-tool nozzle designation in the same column with clear shared-assignment wording. Snapmaker U1 retains printer-reported nozzle information without a manual nozzle column.
- Rebalances **Maintenance & Management** so Maintenance and Printer management stack in the left column while Diagnostics occupies the right column, collapsing to one column on narrow screens. Maintenance action/help spacing is also corrected so explanatory text no longer crowds or overlaps the buttons.
- Adds regression coverage for the tab structure, maintenance-style selector reuse, responsive layouts, multi-tool/nozzle columns and maintenance-panel spacing.

## v0.39.1

- Adds persistent **per-tool nozzle-size designation** for Prusa CORE One+ INDX 4 and INDX 8. Every physical T0–T3/T0–T7 tool can be assigned independently and the effective nozzle size is consumed by existing fixed-tool queue compatibility.
- Clearing a per-tool nozzle assignment falls back to the nozzle reported by PrusaLink when available; if no nozzle size is reported, it becomes unknown so unattended jobs requiring an explicit nozzle remain **Needs review** rather than being guessed.
- Switching a CORE One+ from Standard 1-tool to INDX automatically migrates the existing single-tool nozzle designation to physical T0. Returning from INDX to Standard migrates T0 back to the single-tool designation, while preserving the other INDX tool metadata for a future upgrade.
- Adds controller API/UI and regression coverage for per-tool nozzle persistence, manual-over-reported precedence, and the 1 ↔ 4/8 tool migration path.
- Standardizes **all controller-managed nozzle-size designation controls** to fixed dropdown lists. FlashForge AD5M/AD5M Pro and Creator 5/Creator 5 Pro now use their declared 0.25 / 0.4 / 0.6 / 0.8 mm choices instead of a free-typed numeric field, and the API rejects unsupported designation values. Prusa keeps its model-specific 0.25 / 0.4 / 0.5 / 0.6 / 0.8 / 1.0 mm choices.

## v0.39.0

- Adds initial **Prusa CORE One+** support through the printer's built-in local PrusaLink HTTP API, without requiring Prusa Connect cloud access.
- Marks CORE One+ support in the **Add Printer** dropdown as **Experimental** while physical validation is still pending.
- Refactors Prusa support into a reusable **PrusaLink family adapter** plus model-profile catalogue. PrusaLink model profiles auto-register with the controller; CORE One+ is now a thin model-specific wrapper/profile rather than owning protocol/authentication/file/job-control logic.
- Adds PrusaLink Digest authentication using the local username/password shown by the printer, with optional `X-Api-Key` authentication for firmware/configurations that expose an API key.
- Supports live printer/job status, nozzle and bed telemetry, printer-local printable-file browsing, streamed `.gcode` / `.bgcode` upload, post-upload file verification, print start, and pause/resume/cancel.
- Supports **Standard 1-tool**, **INDX 4-tool** and **INDX 8-tool** CORE One+ configurations. A printer can be switched between those controller configurations from printer details after an INDX hardware upgrade, without deleting/re-adding it; changes are blocked while the printer is active.
- INDX queue compatibility uses fixed sliced tool indices (T0→T0, T1→T1, etc.) rather than U1-style remapping. Known per-tool material/nozzle/colour mismatches block unattended scheduling, while missing PrusaLink per-tool metadata requires review rather than being guessed.
- Adds controller-side material/colour assignment for every Prusa physical tool. Standard T0 and INDX T0–T7 can each be assigned independently; the chosen colour family is stored persistently, rendered on dashboard/toolhead swatches and consumed by automatic queue colour compatibility. Clearing an assignment returns that tool to any PrusaLink-reported metadata.
- Exposes manual filament and nozzle designation for the standard single-tool configuration while retaining the nozzle diameter reported by PrusaLink when available.
- Uses the standard CORE One+ limits of 290 °C nozzle, 120 °C heatbed, 55 °C chamber and 250 × 220 × 270 mm build volume. INDX 4/8 configurations use 300 °C nozzle metadata and a 248 × 205 × 270 mm usable build volume. Temperature/chamber control and camera streaming remain disabled until their local control paths are validated on physical hardware.
- Adds Prusa CORE One+ simulator profiles for Standard 1-tool, INDX 4-tool and INDX 8-tool configurations. The local PrusaLink emulator covers Digest authentication, per-tool status/metadata, storage/files, upload verification, print start and pause/resume/cancel, with end-to-end interoperability coverage against the production adapter.
- Adds matching **400 × 190** dashboard artwork for the Prusa CORE One+, using the same contained WebP asset treatment and regression checks as the existing supported-printer images.
- UI consistency: standardizes filament-type selection across U1, Prusa and FlashForge controller-managed filament assignments using the same fixed U1-style dropdown. The previous Prusa/FlashForge editable datalist fields are removed; unexpected printer-reported material names remain visible without becoming free-text choices.
- Adds regression coverage for adapter registration/configuration, capability boundaries, PrusaLink state normalization, Digest authorization construction, file-tree flattening, status telemetry normalization and simulator interoperability.

## v0.38.1

- Fixes Print Library **Edit details** filament-cost assignments not being persisted. The form was collecting per-tool filament selections correctly but the browser metadata update helper omitted `filamentAssignments` from the PATCH request.
- Print Library cost-filament dropdown labels now always include the material type (for example PLA/PETG/ASA) alongside brand, product, colour and cost.
- The Stacked Layers header mark and **STACKED LAYERS** name now link to `https://www.stackedlayers.co.uk` in a new tab.
- Adds regression coverage proving the UI sends filament assignments, stored assignments survive subsequent Print Library reads/listing, and material type remains visible in filament option labels.

## v0.38.0

- Introduces a Stacked Layers branding prototype for the main controller header using a responsive vector interpretation of the supplied stacked-layer mark alongside the existing Print Farm Controller product name.
- The brand mark follows the current Light/Dark theme automatically and collapses cleanly on smaller screens.
- The existing embedded browser favicons are intentionally unchanged.

## v0.37.1

- Replaces the free-text filament catalogue currency field with a controlled dropdown covering **36 commonly used world currencies**, including GBP, USD, EUR, JPY, CNY, CAD, AUD, CHF, INR, BRL and other major regional currencies.
- New and changed filament catalogue entries are validated server-side against the supported currency list, while existing stored legacy three-letter currencies remain readable for backward compatibility and must be changed to a supported currency before saving through the UI.
- Adds UI and catalogue regression coverage for the supported currency choices.

## v0.37.0

- Adds persistent **Reports & analytics** with graphical daily outcome trends, date/printer/group filters, print outcome rates, run hours, popular-file reporting, filament usage/spend and transparent per-printer reliability indicators. Problem-printer guidance is based on observable counts/rates and recent-vs-earlier failure-rate trends rather than an opaque health score.
- Adds a persistent controller-owned filament catalogue with material, optional brand/product/colour, currency and cost per kg. Print Library files can explicitly map each logical tool to a catalogue entry, and sliced filament usage in grams is retained from supported G-code and embedded 3MF plate G-code.
- Adds Orca/Bambu slicer profile auto-matching for costing. Per-tool `filament_settings_id` and `filament_vendor` metadata are retained and used to select an unambiguous matching catalogue brand/product before falling back to a unique material-only match. Ambiguous matches continue to require explicit selection.
- Each print snapshots its material usage, catalogue identity, price/kg and estimated cost before start, so historical print costs remain stable when catalogue prices are changed later.
- Adds an independent persistent `reporting-history.json` store so long-term analytics are not limited by the recent queue/history retention window. Existing terminal queue history seeds the reporting store and subsequent terminal jobs are deduplicated by job ID.
- Portable backup/restore now includes the filament catalogue and reporting history in addition to Print Library metadata/files and print jobs. Older backups restore with backward-compatible empty defaults for the new stores.
- Adds regression coverage for filament gram/profile parsing, catalogue persistence, slicer-profile cost auto-matching, immutable cost snapshots, reporting aggregation, reporting UI wiring, and backup/restore participation.

## v0.36.0

- Experimental Microsoft OneDrive backup and restore is added on top of the v0.35.0 S3-compatible baseline. Backup & recovery now supports OneDrive for manual backups, daily/weekly scheduled backups with controller-scoped retention, and direct cloud restore through the same provider registry and unchanged inspection/staging/restart/rollback engine used by Google Drive and S3.
- Authentication uses Microsoft's device-code OAuth flow with delegated `offline_access Files.ReadWrite.AppFolder`. No Microsoft client secret is required, and PFC is limited to its dedicated OneDrive application folder. Production bundles can embed `PFC_MICROSOFT_CLIENT_ID`; source/development deployments can use a custom UI or environment client ID.
- OneDrive uploads use Microsoft Graph upload sessions and pair the verified `.pfcbackup` with a small PFC metadata sidecar used for safe installation-scoped retention. Microsoft refresh-token rotation is persisted safely, `<DATA_DIR>/integrations/one-drive.json` is excluded from backups/diagnostics, and short-lived access tokens remain memory-only.
- OneDrive is intentionally marked **Experimental** until live Microsoft account/Graph validation is completed. The reconciliation preserves the full v0.35.0 S3 implementation and MinIO CI integration. Automated coverage now validates Google Drive, OneDrive and S3 together in one controller baseline.

## v0.35.0

- Generic S3-compatible backup and restore. Backup & recovery can now store the canonical verified/compressed `.pfcbackup` in S3-compatible object storage for manual backups, daily/weekly scheduled backups with controller-scoped retention, and direct cloud restore through the existing provider registry and unchanged inspection/staging/restart/rollback engine.
- The S3 client is implemented with Node built-ins and AWS Signature Version 4, preserving the controller's zero runtime npm-dependency model. Configuration supports endpoint, bucket, region, object-key prefix, path-style or virtual-hosted addressing, and access-key credentials. HTTPS is required unless the user explicitly enables insecure HTTP for a trusted local development service such as MinIO.
- Each uploaded S3 backup has a small `.pfcmeta.json` sidecar containing PFC ownership/retention metadata. Scheduled retention therefore removes only older scheduled backups owned by the same controller installation while leaving manual and foreign-installation backups untouched. S3 credentials live under `<DATA_DIR>/integrations/s3.json`, are excluded from portable backups/diagnostics, and the secret key is never returned through the status API.
- Automated validation includes Signature V4/unit coverage plus an integration test that starts a pinned MinIO server and performs real bucket creation, upload, listing, restore download and retention operations.

## v0.33.0

- Cloud restore source support. Backup & recovery can now restore directly from connected cloud storage as well as a local `.pfcbackup`. The restore UI dynamically discovers cloud providers, lists eligible backups, requires explicit selection and inspection, downloads to temporary local staging, and then uses the unchanged existing restore inspection/staging/restart/rollback engine. Google Drive is the first provider. The selected cloud artifact is downloaded and revalidated again when restore is staged, and changing the selected source invalidates the previous inspection. The provider registry is intentionally generic so future cloud services can add list/download support without duplicating restore logic.
- Google Drive backup destination. Backup & recovery connects Google accounts through Google's limited-input/device OAuth flow with the narrow `drive.file` scope, creates and uses a visible **Print Farm Controller Backups** folder, uploads the existing verified/compressed `.pfcbackup` artifact manually or from the existing daily/weekly scheduler, tests connectivity, supports disconnect/reconnect, and applies retention only to scheduled backups created by the same controller installation. Production bundles can embed the shared Print Farm Controller OAuth client at build time from `PFC_GOOGLE_CLIENT_ID` / `PFC_GOOGLE_CLIENT_SECRET`, allowing normal customers to simply select **Connect** without creating their own Google Cloud project. GitHub Actions injects those values into production container builds through BuildKit secrets while pull-request builds receive none. Advanced custom OAuth configuration and runtime `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` overrides remain available. Built-in credentials are not copied into controller data; customer refresh-token/folder state and any deliberate custom override live under `<DATA_DIR>/integrations/google-drive.json`, access tokens remain memory-only, and integration state is excluded from portable backups and diagnostics. Local, mapped-drive and NAS scheduled destinations remain supported unchanged.

## v0.32.0

- Backup compression. Portable `.pfcbackup` files remain ZIP-compatible but now use streaming DEFLATE compression for JSON, G-code, text and other compressible payloads while keeping already-compressed formats such as 3MF and PNG/JPEG/WebP stored without recompression. Restore remains backwards-compatible with older method-0 backups and now accepts both ZIP STORE and DEFLATE entries. CRC-32 and SHA-256 continue to validate the uncompressed logical payload, and decompression is bounded by each entry's declared uncompressed size. No additional runtime dependency is required because compression uses Node.js `node:zlib`.

## v0.31.1

- Restore compatibility fix. Backup inspection now accepts a configured printer belonging to multiple custom printer groups, matching the multi-group membership model introduced in v0.28.0. Restore validation still rejects missing printers, duplicate group IDs/names, missing queue group references and missing maintenance group references. Backups created with valid multi-group membership can now be inspected and restored on replacement/container deployments.

## v0.31.0

- Container deployment baseline. The controller can run in a Node 24 Linux container with persistent `/data` and `/logs` mounts. Direct Snapmaker U1 and FlashForge AD5M Pro connectivity, including U1 camera access, has been validated through Docker Desktop. Container LAN discovery supports an optional bounded `DISCOVERY_SUBNET` CIDR (for example `192.168.1.0/24`): Snapmaker discovery actively probes Moonraker hosts on that subnet, while FlashForge discovery adds the subnet's directed broadcast plus bounded per-host UDP discovery probes, with an active TCP `~M115` identity fallback on port 8899 for Docker Desktop environments where UDP discovery replies do not traverse the virtual network. Native non-container discovery remains unchanged when the setting is omitted.

## v0.30.4

- Standardises licence storage in the controller data directory. Source/development and packaged deployments now use `DATA_DIR/license.json` as the canonical signed licence location. A valid legacy application-root `license.json` is verified before being automatically migrated into the data directory and the old copy is removed after a successful migration; invalid/tampered legacy files are never promoted. Licence installation/replacement also writes only to the canonical data location, and production ignores alternate licence-file environment paths. This gives Windows, source, Linux and future container deployments one persistent licence-storage model.

## v0.30.3

- Community Edition supports 3 physical printers. The unlicensed/Community fallback allowance is increased from 2 to 3 physical printers. Pro remains 10 and Farm remains 25. Simulator printers continue not to consume licence slots. Existing signed licences retain their explicitly signed `maxPrinters` value until deliberately reissued.

## v0.30.2

- Long-running memory stability and dashboard filter hierarchy. Dashboard live-event streaming now respects HTTP backpressure, coalesces pending fleet snapshots for slow or suspended clients and caps per-client buffering to prevent unbounded Node heap growth. Completed Bambu MQTT polling sockets are force-closed after DISCONNECT, and Diagnostics now exposes current V8 heap/RSS telemetry with warning, critical and danger logging thresholds plus recovery logging. The dashboard Printer group selector now appears above the summary/status filters, and the first summary filter is labelled **All Printers**. The full `npm test` suite passed and long-running memory utilisation was validated as stable before release.

## v0.30.1

- Circular dashboard filament swatches. Dashboard filament colour indicators now render as circles instead of rounded squares. Swatch size, spacing, tooltip metadata, `+N` overflow behaviour, Light/Dark styling and printer-card dimensions are unchanged.

## v0.30.0

- Sharper dashboard printer imagery. The eight bundled dashboard printer model assets have been upgraded from the reduced 260×124 versions to 400×190 transparent WebP images, matching the full height of the existing 190 px dashboard image well and avoiding browser upscaling that could make the printers look soft. The printer-card layout, model mapping, Light/Dark backgrounds, filament-colour overlay and live camera behaviour inside printer details are unchanged. The higher-resolution assets use high-quality WebP compression to retain fine printer detail while keeping the bundled files compact.

## v0.29.0

- Dashboard filament swatches. Dashboard printer tiles now overlay the currently loaded or controller-assigned filament colours on the existing printer-image area without increasing card height. Snapmaker U1 and FlashForge multi-tool printers use their live per-tool filament state; Bambu printers use the reported external-spool/AMS/AMS Lite material sources. Up to four 16 px colour swatches are shown with hover details for source/tool, material, colour and whether the value is printer-reported, RFID-detected or controller-assigned. Printers with more than four material sources show `+N` rather than wrapping onto another row, preserving tile alignment. Light and Dark themes have matching overlay treatments.

## v0.28.0

- Multi-group printer membership. A configured printer can belong to any number of custom printer groups at the same time. Adding a printer to one group no longer removes it from other groups. Dashboard group filtering, queue group restrictions and group-wide maintenance continue to evaluate the selected group independently, so the same printer can legitimately participate in several scheduling or maintenance groupings. Existing `printer-groups.json` files remain compatible; no data migration is required. The Printer groups editor shows a printer's other current memberships while editing a group.

## v0.27.0

- Dashboard model imagery. Dashboard printer cards use eight independent bundled WebP model images for AD5M Pro, Creator 5, Creator 5 Pro, Snapmaker U1, Bambu P1P, P1S, X1 Carbon and A1 Mini instead of polling live camera snapshots. Each image is rendered normally with `object-fit: contain` on a theme-aware dashboard surface, avoiding sprite cropping/positioning. Live camera streams, camera health and Restart camera remain available inside each printer's detail view. Unknown future printer models use a neutral dashboard fallback rather than a camera feed.

## v0.25.1

- Dashboard group filtering baseline. `feature/dashboard-group-filter-v0251` adds a **Printer group** selector to the main dashboard. Choosing a custom group restricts the visible printer cards to that group's current members, while the existing Printers / Online / Printing / Needs attention / Maintenance filters continue to work within the selected group. Summary counts and the maintenance-alert filter reflect the selected group, group membership changes update the dashboard selector/filter immediately, and **Show all printers** clears both the status and group filters. Maintenance task assignment also now starts the maintenance interval immediately: a newly assigned individual, group-wide, or model-wide task is treated as freshly serviced for scheduling purposes and cannot be completed until it reaches the existing **Due soon (80%)** threshold; no artificial completion-history entry is created.

## v0.25.0

- Printer groups baseline. `feature/printer-groups-v0250` adds controller-owned custom printer groups. A configured printer can belong to zero or one group; assigning it to a new group automatically moves it out of its previous group. The **Printer groups** window in the controller menu creates, edits and deletes groups and manages membership. **Next available compatible printer** queue jobs can optionally be restricted to a group; the normal compatibility, material/nozzle, licence, busy-state and bed-clearance checks still apply, but printers outside the selected group are not eligible. Group membership is evaluated live while a job waits, so moving printers between groups immediately affects future dispatch. Maintenance assignment now supports **Individual printer**, **Printer group**, and **Printer model**, with group-wide rules inherited by current group members while preserving independent per-printer baselines, completion state and history. Printer groups are persisted in `data/printer-groups.json` and participate in logical `.pfcbackup` backup/restore.

## v0.24.0

- Maintenance tracking baseline. Maintenance tracking is controller-owned and manufacturer-agnostic, with calendar-day, controller-observed print-hour, and observed print-cycle intervals. The Maintenance view includes **Add maintenance tasks**, **Model-wide maintenance rules**, **Group-wide maintenance rules** in v0.25.0, and **Individual printers**. The printer view shows current/due-soon/due tasks, observed usage and recent completion history, while edits automatically switch into the add/edit form. Each printer also has a confirmed **Clear history** action that deletes only its completion-history log; task schedules, last-completed state, usage counters, baselines and due status are preserved. Completing a task records an immutable history entry with optional notes and a usage snapshot before resetting that task's interval baseline. After a task has been completed on a printer, repeat completion is locked until that printer reaches the existing Due soon threshold at 80% of the interval; the UI disables Complete until then and the API enforces the same rule. Maintenance data is persisted in `data/maintenance.json` and is included in `.pfcbackup` backup/restore. Maintenance-store writes use a serialized temp-file replace with bounded retries for transient Windows `EPERM`, `EACCES`, and `EBUSY` rename failures, and a failed save no longer poisons later queued saves. Observed usage begins when this controller tracks the printer and is intentionally labelled controller-observed rather than manufacturer lifetime usage. Live maintenance state is also published with fleet updates: a top-bar alarm appears when any printer is Due soon or Due, shows the number of affected printers, and filters the dashboard to those printers when selected. Each dashboard printer card and printer-detail header shows a maintenance-status wrench icon, with the printer detail Maintenance panel also showing the current tracking summary. Dashboard cards reserve a consistent header height on multi-column layouts and a consistent one-line footer error slot, so model images and Open printer buttons remain aligned even when printer/model text wraps or only some printers have an offline error. The dashboard-card wrench and the matching wrench in the printer-details header are clickable: either shortcut opens Maintenance focused on that printer, preselects it for new printer-specific tasks, scrolls directly to its maintenance card, and briefly highlights it. Using the printer-details shortcut closes the printer-details dialog first.

## v0.22.0

- Colour-family queue matching baseline. Slicer hexadecimal colours are retained as shade metadata but automatic queue eligibility no longer requires an exact RGB/hex match. Required and loaded colours are classified into practical colour families (red, orange, yellow, green, cyan, blue, purple, pink, brown, black, white and grey). Same-family shades are compatible; different families remain blocked. FlashForge manual filament designation now uses colour family only; legacy saved hex-only designations are migrated logically by deriving their family, and saving a new manual designation clears the legacy exact shade. FlashForge, editable/non-RFID Snapmaker U1, and simulated Bambu AMS/AMS Lite/external-spool colour-family dropdowns render a matching square colour swatch inside every list option and the selected value. The U1 and Bambu simulator translate the selected family to a representative hex colour internally; official U1 RFID filament and real Bambu tray colours remain printer-reported. Real Bambu AMS/AMS Lite/external-spool telemetry retains the printer-reported exact hex but derives a colour family for compatibility and display. When multiple U1 tools or Bambu AMS sources satisfy the same material/nozzle/colour-family requirement, CIELAB colour distance is used only to prefer the closest shade.

## v0.21.0

- Print Library printer targeting. Print Library files can optionally be designated for a specific supported printer model. The target is selectable when adding a file, editable later, searchable/displayed in the library, copied into queued-job snapshots, and enforced by Next Available compatibility so a targeted file is only offered to matching printer models. Files with no target remain unrestricted.

## v0.20.2

- Dashboard click reliability. Live fleet updates no longer detach and reinsert every existing printer card when the card order is unchanged. This removes a browser click race where an **Open printer** button could be moved between pointer-down and click, making the action appear to do nothing intermittently.

## v0.20.1

- Printer-detail opening reliability. The printer dialog opens immediately with a loading state instead of waiting for the printer file-list request to finish. Slow printer storage access therefore no longer makes **Open printer** appear unresponsive. Stale asynchronous opens are discarded when the dialog is closed/reopened, and top-level open failures are surfaced instead of failing silently. Dashboard connection errors render below **Open printer**, keeping action buttons aligned across printer cards.

## v0.20.0

- Diagnostic logging. Controller-wide structured diagnostic logs are stored independently under `logs/` by default, with `LOG_DIR` available separately from `DATA_DIR` for container/PV deployments. The overflow menu includes **Diagnostics** for recent-log viewing/filtering, temporary 30-minute verbose DEBUG logging, and downloading a sanitized ZIP support bundle. Credential-like fields are redacted, print files and licence contents are excluded, and packaged Windows installs grant normal-user write access to both `data/` and `logs/`.
- `LOG_DIR` defaults to the application-local `logs/` directory and can be overridden independently (for example `LOG_DIR=/logs` in a container). Diagnostic logs are intentionally kept outside `data/` so the two locations can be mounted as separate persistent volumes.

## v0.19.0

- Printer activity status messaging. Printer detail windows now use the prominent activity banner introduced for Snapmaker U1 bed levelling as a general controller status surface. Controller-tracked bed levelling and calibration can be shown consistently across supported printer types, while chamber preheat is surfaced at the top of the printer window without duplicating its existing dashboard preheat strip.

## v0.18.0

- Concurrent client safety. Multiple browser clients can continue to monitor the same controller through the existing shared SSE/live-state backend, while conflicting writes are now coordinated centrally. Per-printer arbitration protects both overlapping controller transactions **and** longer-lived physical printer activity. A live compatibility matrix distinguishes idle, printing, paused, chamber-preheat, manual-heating, bed-levelling, calibration, fault and other busy states. Safe controls such as camera viewing, print pause/resume/cancel where appropriate, temperature/fan adjustments during a print, file upload, and heaters-off remain available while incompatible actions such as starting another print during levelling/calibration/preheat are blocked. This release does **not** add user accounts, authentication, roles or per-user audit history — connected clients still share the same controller authority.
- Hardens the controller for concurrent operators. Direct print/control commands, batch operations, file distribution, queue-driven starts/cancels, chamber preheat interactions, licence-slot changes, printer removal and compatibility designations share a per-printer operation coordinator. The coordinator now evaluates live printer state before each mutation, while controller-started bed levelling and U1 tool-offset calibration are tracked beyond the HTTP request so they remain protected for their physical workflow. U1 Moonraker `idle_timeout` macro activity is also surfaced to distinguish long-running printer macros from an actually idle machine. Print Library/queue mutations and printer-registry mutations are serialized, and printer/material/queue metadata persistence is hardened against concurrent read-modify-write loss and temporary-file collisions.

## v0.17.0

- Bambu Lab A1 Mini support. The existing experimental Bambu LAN adapter now supports A1 Mini configuration, status/control, FTPS file handling, TLS/JPEG camera access and AMS Lite material mapping. Single-material `.gcode` starts are enabled on A1 Mini using the existing Bambu `gcode_file` path, but remain experimental until validated on physical hardware; multi-material AMS Lite jobs require sliced `.3mf`. A1 Mini support remains experimental until validated on physical hardware.
- Adds experimental Bambu Lab A1 Mini support. A1 Mini uses the existing Bambu MQTT TLS/FTPS integration, the same TLS/JPEG camera path used by P1-family printers, a model-specific 80 °C maximum bed limit, and single-nozzle AMS Lite mapping through the existing Bambu material-source workflow. The controller supports `.3mf` plus single-material `.gcode` on A1 Mini; raw G-code start remains explicitly unverified on physical A1 Mini hardware. The integrated Printer Simulator includes an A1 Mini profile for controller testing.

## v0.16.1

- Aligns dashboard available-state colours and Print Library preview presentation. Idle and Ready printer badges on the main dashboard are green in both Dark and Light modes, while existing warning/error colours remain unchanged. Print Library thumbnail and enlarged preview backgrounds now use the existing Light-mode preview colour (`#f3f7fa`) in both themes so model images are presented consistently.

## v0.16.0

- Adds production packaging. The controller can now be bundled into a hardened Windows x64 Node SEA executable with embedded UI, simulator resources and trusted licence verification keys. The release includes an Inno Setup 7 installer for Program Files deployment, writable application-local `data/`, packaged licence storage at `data/license.json`, and an optional Authenticode signing workflow for future production releases.

## v0.15.6

- Adds dashboard fleet filtering and consolidates the latest controller usability/storage improvements. The Printers, Online, Printing and Needs attention summary cards can filter the dashboard fleet in place; the active filter is highlighted, filtering stays in sync with live printer/queue state, and an empty-filter state provides a quick return to all printers. This build also includes application-local `data/` storage, consistent **Snapmaker U1** model naming, and the combined printer-card hover/focus highlight treatment.

## v0.15.5

- Adds visual previews to the Print Library. The controller extracts and caches slicer-provided preview images when available, using Orca/Bambu-style 3MF plate thumbnails (including `Metadata/plate_1.png` and related fallbacks) and embedded PNG/JPEG G-code thumbnail blocks. Library cards show a compact preview beside the file details; clicking it opens a larger viewer. Existing library files are backfilled automatically the first time they are read, and files without a supported embedded image show a **No preview** placeholder. Preview images are cached as separate files beside the stored print file rather than embedded into `metadata.json`.

## v0.15.4

- Adds free-text metadata to Print Library files. When adding a file, users can optionally enter up to 4000 characters of description/notes explaining what the part is, its intended use, print guidance or other context. Notes are displayed on library cards, included in library search, can be edited later with **Edit details**, and are also available when uploading a new file through the queue workflow.

## v0.15.3

- Preserves the red Offline/Error printer status treatment in Light mode. The generic light-theme badge styling no longer overrides these warning states.

## v0.15.2

- Simplifies the controller top bar with a responsive overflow menu. The Light/Dark toggle remains permanently visible. Printer simulator and Licence move into a compact **⋮** menu, while Fleet operations stays visible on wider screens and automatically moves into the same overflow menu when horizontal space is tighter.

## v0.15.1

- Adds detected filament colours to Print Library entries. When colour metadata is available in the G-code/GX/3MF requirements, each library card now lists the actual colours with a swatch, hexadecimal value and RGB value.

## v0.15.0

- Introduces the persistent Print Library. Controller-owned G-code/GX/3MF files are now durable independently of the queue and history. The dashboard exposes a searchable **Print library** browser where files can be uploaded, inspected for detected material/nozzle/tool requirements, queued to the next compatible printer, or explicitly deleted when no queue/history record still references them. Existing `queue-files/` entries migrate automatically into `print-library/` while retaining their UUIDs, so current queue/history records remain valid. Uploading the same file content again reuses the existing library entry by SHA-256 instead of storing a duplicate.

## v0.14.12

- Standardises the Snapmaker model name in the controller UI. Snapmaker U1 printers display as **Snapmaker U1** on dashboard cards and in printer-details diagnostics, while the stored model remains `U1` and the adapter identity remains unchanged.

## v0.14.11

- Aligns the simulated FlashForge material telemetry with physical AD5M-family behaviour. The simulator still tracks its virtual filament internally, but its FlashForge `/detail` response no longer claims that the printer reports a loaded material type by default. This makes the controller show **Clear designation** instead of **Use printer value** unless a real printer-reported value is actually available.

## v0.14.10

- Adds hover/focus colour feedback to all enabled buttons. Dark mode brightens buttons under the pointer or keyboard focus, while light mode slightly darkens them. Disabled buttons are unchanged.

## v0.14.9

- Renames the application from Printer Fleet Controller to Print Farm Controller. The browser title, dashboard header/footer, controller messages, simulator wording and documentation now use **Print Farm Controller**. Existing application-data directories and machine-facing compatibility identifiers retain their historical `Printer Fleet Controller` / `printer-fleet-controller` names so upgrades, scripts and integrations continue to work without migration.

## v0.14.8

- Adds production-hardened offline signed licensing. The controller verifies Ed25519-signed `license.json` files and fails closed to Community Edition when no valid licence is installed. Community permits 2 physical printers, Pro 10 and Farm 25; simulator printers do not consume licence slots. Existing printers are never deleted if a licence allowance is reduced. Licence installation/replacement is available from the controller UI and takes effect without restarting. Production startup ignores environment-variable attempts to elevate the edition or trust an arbitrary signing key.

## v0.14.x

- also establishes the controller's edition/entitlement model for future feature gating. The signed licence carries its edition, physical-printer allowance and optional additional feature entitlements. The current production enforcement path includes signed-licence verification and physical-printer slot limits; further feature-by-feature gating can be layered onto the defined entitlement model without changing the licence-file format.

## v0.13.0

- now includes an **experimental Bambu Lab P1P/P1S/X1C controller adapter**. It reads LAN status and external-spool/AMS telemetry, maps sliced 3MF filaments to loaded AMS slots, and sends print/job/temperature/fan commands over MQTT TLS. It also performs verified `.3mf`/`.gcode` storage operations over implicit FTPS. P1 cameras feed the existing dashboard camera manager; physical X1C camera decoding is not yet supported because X1C supplies RTSPS/H.264 rather than the P1 TLS/JPEG stream. The implemented workflows are tested against the Bambu emulator but have not been validated on physical Bambu hardware.
- includes a controller-managed, loopback-only **Printer Simulator** with its own responsive light/dark UI. It can run multiple simulated FlashForge Adventurer 5M Pro, Snapmaker U1, Bambu Lab P1P, P1S and X1C endpoints, exercise the controller's production adapters, accelerate print progress, manage virtual files and temperatures, and inject repeatable connection, cancellation, verification, camera, material and nozzle faults. Simulator support is a development aid and does not replace final validation on physical hardware.

## v0.12.16

- adds a combined **Snapmaker U1 third-party filament type and colour control** to each toolhead card. One **Set filament on U1** button sends the selected generic material profile and colour together using stock `SET_PRINT_FILAMENT_CONFIG`; the controller verifies both values and immediately uses them for queue compatibility. The control is available only for idle, loaded, editable third-party slots, while official RFID filament remains locked. The combined workflow has been validated on physical U1 hardware.

## v0.12.15

- moves production-batch controls into a dedicated full-width row below the batch copy list, preventing Pause/Resume, priority, quantity and cancellation controls from overlapping batch items at narrower queue widths.

## v0.12.14

- adds persistent **High / Normal / Low queue priorities** for individual jobs and production batches. The scheduler ranks priority before manual order, promotes waiting work one level every six hours to prevent starvation, prefers a compatible printer where the file is already verified, and records why a printer was selected.

## v0.12.13

- adds an accessible **Light / Dark** appearance switch in the main header. The selected theme is saved in the browser; before a choice is made, the interface follows the device colour-scheme preference.

## v0.12.12

- prevents a newly assigned queue job from inheriting the previous print's retained 100% progress. A job remains **Starting — 0%** until an active printer state confirms the new print, including when the same filename is reprinted; progress is then tracked only from the confirmed new run.

## v0.12.11

- presents FlashForge's latched `CANCEL` result as **Cancelled** while bed clearance is pending and **Ready** after acknowledgement. The raw printer status remains visible in the printer detail diagnostics and is not altered or reset on the printer.

## v0.12.10

- fixes FlashForge queue recovery when the printer retains `CANCEL` and the cancelled filename. Cancelled states now create or retain a bed-clearance interlock, then become startable only after the operator confirms the bed is clear. This also covers prints cancelled outside the controller.

## v0.12.9

- fixes Snapmaker U1 queue availability after a completed print. Moonraker may retain the previous filename after reporting an idle/complete state; the queue now treats the explicit idle state as authoritative while continuing to enforce the separate bed-clearance interlock.

## v0.12.8

- adds **native Snapmaker U1 filament colour editing** for manually assigned third-party filament. Toolhead status can write a selected colour to the idle U1 using its stock `SET_PRINT_FILAMENT_CONFIG` command, verifies the printer read-back, and keeps official RFID filament colours locked.

## v0.12.7

- shows FlashForge controller-assigned filament colours as both hexadecimal and **RGB(r, g, b)** values in Toolhead status. The stored colour and automatic queue compatibility behaviour are unchanged.

## v0.12.6

- keeps the Snapmaker U1 hexadecimal filament colour on the main toolhead metadata line and moves **RGB(r, g, b)** onto its own line so the value fits cleanly inside each toolhead status card. Print setup and material preflight keep the combined hex + RGB display.

## v0.12.5

- shows Snapmaker U1 filament colours as both hexadecimal and **RGB(r, g, b)** values in toolhead metadata, material preflight, and physical-head choices.

## v0.12.4

- adds a persistent **filament colour designation** alongside material type for FlashForge printers. The printer window now provides a colour picker; the controller-normalized tool state and automatic queue compatibility use the assigned colour, including blocking explicit colour mismatches.

## v0.12.3

- adds **Upload file** inside each supported printer window. Individual uploads use the printer adapter's declared file types, are verified in printer storage before reporting success, save available material metadata, and refresh the printer file list after upload.

## v0.12.2

- adds **Reprint batch** to finished production batches in Recent history. Reprinting creates a new automatic production batch with the same quantity, staged controller file and print options while preserving the original history.

## v0.12.1

- adds dedicated regression coverage ensuring a cancelled queued print remains in Recent history and can be reprinted with its original staged file and print options.

## v0.12.0

- adds **production quantity / batch printing**. A single staged G-code can represent 2–999 copies, with copies automatically distributed across compatible idle printers. Production batches expose overall progress, per-copy printer/status, pause/resume, cancel remaining copies, and safe quantity changes while retaining existing bed-clearance and preflight protections.

## v0.11.3

- makes **Clear history** immediately delete controller-staged queue files that are no longer referenced. Files still referenced by queued/active/review jobs, retained bed-clearance records, or another history item are preserved. The normal one-hour orphan grace period remains in place for non-explicit cleanup paths. **This is historical behavior and is superseded by v0.15.0:** migrated Print Library files are no longer pruned by queue/history cleanup and require explicit deletion.

## v0.11.2

- moved the default controller application-data directory to the then-current manufacturer-neutral **Printer Fleet Controller** path. Current builds now store runtime data in the application-local `data/` directory instead of the user profile. On first startup, existing data is migrated automatically from the former profile location (or the older `FlashForge Fleet` location), including printer configuration, queue/history, Print Library files, emulator settings and material metadata. Custom `DATA_DIR` locations are unchanged.

## v0.11.1

- adds a persistent **Controller nozzle designation** for FlashForge 5M-family printers. Set the installed nozzle diameter in Toolhead status so file-centric automatic queue compatibility can safely match staged G-code nozzle requirements instead of holding FlashForge jobs for review when the local API cannot report nozzle size.

## v0.11.0

- adds a file-centric **Next available compatible printer** queue. The controller can persistently stage an uploaded G-code file, inspect its tool/material/colour/nozzle requirements, evaluate the live fleet, choose an eligible idle printer with a clear bed, upload and verify the file, run a fresh printer-specific preflight, and then start it. Existing fixed-printer queue jobs remain supported.

## Historical packaging validation

- Packaging validation: the hardened Windows x64 single-executable build has been manually validated successfully with embedded controller UI, simulator resources and trusted licence public keys.
- Installer validation: the Inno Setup 7 Windows installer has been built and manually validated successfully under Program Files, including normal non-admin runtime writes to `data/` and packaged licence storage at `data/license.json`.

