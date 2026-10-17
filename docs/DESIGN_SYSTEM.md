# Print Farm Controller — SaaS UI design system (Phase 1)

**Status:** In development on `feature/preact-saas-design-system`, based on v0.53.0. No printer-control protocols, endpoint contracts or edition limits change in this phase.

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

The **Preact workspace breadcrumb** in `ui/workspace-shell.jsx` subscribes to `pfc:shell-route-state` emitted by the existing `renderControllerRoute()` function. Breadcrumb navigation dispatches `pfc:shell-navigate` and is resolved through existing `navigateController()`: the controller still owns history, APIs, dialogs, and command safety. With the Preact bundle absent, the inline breadcrumb text is still refreshed by `app.js`.

On screens <=760px, the sidebar becomes a modal-like drawer with a dimmed backdrop, Escape and backdrop dismissal, focus restoration, keyboard Tab containment and `inert` while closed. Mobile users gain an explicit Add printer button inside the drawer that delegates to the pre-existing Add Printer action. Desktop sidebar navigation is always available. This preserves existing HTML element IDs, route data attributes, keyboard actions and SSR-free behaviour.

Chromium browser tests cover desktop shell geometry, deep-link breadcrumbs, dashboard return navigation, active route semantics, mobile focus/close behaviour and opening Add Printer from mobile. Under `PFC_VISUAL_CAPTURE_DIR`, GitHub Actions captures both themes on the desktop and a light-mode open drawer on mobile for review. No print/protocol/backend modifications.

### Dashboard card image alignment regression
After Phase 1, long printer names and multi-line model details caused some card headers to grow independently, shifting the printer pictures out of alignment in card view. The fix in `public/design-system.css` uses **CSS row subgrid** so cards within the same responsive fleet row share header and image tracks. The highest header sets the shared picture baseline without globally increasing header height or truncating printer names. Activity banners and the card body/footer have separate shared tracks. The existing table view retains its compact layout; a bounded header-height fallback is supplied for browsers without row subgrid.

The Chromium design-system smoke now renders five printers with mixed-length names, measures the picture-slot positions at 1365px and 1800px, asserts they agree within 1.5 pixels per row, and verifies headings do not clip or overlap the images. It also captures the populated dashboard in light/dark themes for visual review.
