# Documentation ownership and maintenance policy

This policy applies to all Print Farm Controller contributions, including code written across separate ChatGPT conversations. Read root [AGENTS.md](../AGENTS.md) and [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md) before editing. GitHub files on the active branch are the source of truth; a chat summary is not a replacement.

## One authoritative location per subject

| File | Owns | Do not add |
| --- | --- | --- |
| `README.md` | Evergreen overview of **current** capabilities, supported hardware, install/run, operations, integrations and deployment; current version identifier | Per-release feature lists, historical version narratives, changelog entries or old-version examples |
| `CHANGELOG.md` | Chronological changes grouped under `## vX.Y.Z`, newest first; compatibility notes and fixed bugs introduced by each release | Duplicated full installation instructions or live project planning |
| `PROJECT_CONTEXT.md` | Present architecture, decisions, unresolved risks, active work item and cross-chat handoff | Running per-version release notes or completed-task diaries; stale “current task” |
| `docs/CONTROLLER_VISUAL_STYLE_GUIDE.md` | Canonical UI language: colours, typography, icons (including tab icons), dimensions, tables, controls, layouts, accessibility and visual QA | Version-by-version UI change notes |
| `AGENTS.md` | Repository-wide development-assistant startup instructions and handoff/checklist | Product release history or duplicative design specifications |
| `docs/DOCUMENTATION_POLICY.md` | This ownership map, change-routing rules and enforcement approach | Individual feature documentation |
| `docs/DESIGN_SYSTEM.md` | Historical implementation/design notes retained as background | New canonical visual rules; the visual style guide takes precedence |

Other subject-specific guides, such as `docs/dependency-security.md`, own their specialist operational policy; link to them instead of duplicating paragraphs in the README.

## Required updates by kind of change

- **New/revised product feature:** Adjust the relevant evergreen README explanation if external usage changes; update the visual style guide if tokens, icons, tabs, tables or layout rules change; reflect enduring architecture decisions or an active limitation in PROJECT_CONTEXT.
- **Release/version bump:** Update `package.json`, `package-lock.json`, the current version shown in README and PROJECT_CONTEXT, and prepend a **single** `CHANGELOG.md` entry describing the release. Do not append release details to README or PROJECT_CONTEXT.
- **Bug fix:** If behaviour changes, update the relevant current-use guidance and tests. Describe the fix under CHANGELOG when a release is cut; avoid adding a second release log anywhere else.
- **UI design change:** Follow the canonical style guide and update its definitive tokens/icon/table/interaction guidance. Keep `docs/DESIGN_SYSTEM.md` as legacy background, not a competing specification.
- **Active development/handoff:** Replace resolved `Current work` or `Current task` text in PROJECT_CONTEXT with the new status. Link to PRs, tests and limitations as needed; do not accumulate closed PR stories.
- **Documentation-only change:** Does not require an application version bump or a new changelog release entry.

## Operational checklist for every PR

1. At the start of work, read `AGENTS.md`, `PROJECT_CONTEXT.md`, this policy and the visual guide if UI work is involved. Verify actual implementation in the active branch rather than treating handoff notes as code evidence.
2. Put each documentation edit in the owning file and link to it from another page only when discoverability needs it.
3. Keep README capability highlights concise (5–10 entries); use present-tense functionality descriptions. No old release version tokens outside the current version metadata.
4. Keep PROJECT_CONTEXT current: decisions and outstanding work only. Remove resolved/currently incorrect statements; do not append one entry per version.
5. Before merge, run `npm test` when a compatible development setup is available. GitHub performs dedicated lightweight docs checks plus the existing development gates where applicable.
6. Review facts and semantics manually: tests can prevent obvious structural drift but cannot decide whether all technical explanations belong in the right place.

## Enforcement and cross-conversation use

- `test/documentation-policy.test.js` is a Node native regression suite: it checks required authority files and references, a compact README overview, absence of historical version tokens, current release metadata, a concise live handoff and canonical visual ownership.
- `.github/workflows/documentation-policy.yml` runs that suite on documentation-only PRs and main-branch changes; the standard `npm test` also includes it in code-change CI. Use the PR checklist for ownership decisions that cannot be machine-verified.
- ChatGPT and other assistants do **not** necessarily auto-load repository files across chats. To make the rule persistent in this ChatGPT Project, add the following instruction to the Project's custom instructions (the repository itself cannot edit those settings):

> Before any work on Print Farm Controller, read the latest `AGENTS.md`, `PROJECT_CONTEXT.md` and `docs/DOCUMENTATION_POLICY.md` from the working GitHub branch. For UI changes, also read `docs/CONTROLLER_VISUAL_STYLE_GUIDE.md`. Follow their documentation ownership rules; version history only belongs in `CHANGELOG.md`. Do not assume previous chat context or commit to `main` without checking tests and explicit merge approval.

The GitHub policy and CI checks remain effective regardless of whether a new chat remembered to load the documents.
