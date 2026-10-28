# Existing users and data preservation

Orbit is already used by real people with valuable existing data. Treat every
change as an upgrade of a populated installation, never as a fresh-install-only
change. Before implementing any change, assess compatibility with saved data.

- When changing stored schemas, formats, keys, defaults or their meaning, provide
  the necessary migration or backward-compatible reader in the same change.
  Cover SQLite tables, JSON/settings, browser localStorage (including filters and
  presets), attachments/files and relationships between records. Renaming or
  removing a feature must not silently discard useful user data.
- Preserve existing values, IDs, links, completion/history and explicit user
  choices. New defaults apply to missing values, not to already configured ones.
  Never reset databases, recreate storage, clear browser state or delete files as
  a shortcut to making an upgrade work.
- Make migrations safe to repeat or explicitly tracked, and transactional where
  possible. Mark completion only after success. For file moves/copies, verify
  the destination before removing any original; retain recoverable originals on
  failure. Plan backup/recovery before any unavoidable destructive conversion.
- Test upgrades from representative old populated data, preservation of useful
  fields/relationships, repeated startup and failure paths relevant to the
  migration. A fresh empty database test alone is not sufficient.
- For every change, determine whether a migration is needed and explain material
  compatibility impacts in the change description. Pure presentation changes
  that do not affect persisted data do not need a dummy migration.
- Document user-visible upgrade behaviour and include functional changes in the
  release history under the rules below. Do not claim universal data safety from
  an untested migration or run migrations against users' live data for testing.

# Orbit: maintaining product help

When adding, changing, or removing user-visible behavior, settings, permissions,
buttons, workflows, limits, or errors:

1. Read the relevant Markdown articles in docs/help/articles and update them in the
   same change. Write Russian user instructions with exact current UI labels.
2. Keep articles focused with short titles/summaries and useful Russian/English
   keywords. Preserve stable article IDs. Do not put full help into model prompts.
3. Describe local versus Azure effects, prerequisites, confirmations, partial
   failure, caching/expiry, and recovery. Never invent behavior from UI labels.
4. Run npm run docs:generate after source edits, then npm run docs:check.
   Generated message/control indexes are supplements, not substitutes for authored
   explanations. Their source fingerprints deliberately detect undocumented drift.
5. For help/search changes run tests/help.test.ts and the TypeScript checks.
   If user explicitly asks to skip tests, honor that and report what was skipped.
6. Never put PATs, tokens, customer data, real ticket content, or raw private logs
   into documentation. Document error templates, not runtime secrets.
7. Keep docs/help bundled in Docker runtime. New help tools remain lazy-loaded.
   General greetings/capability questions must not automatically load articles.

Read docs/help/README.md for the article format and coverage limitations.

When adding or changing tools available to PR review, update the review tool groups
in services/backend/src/review-progress.ts. All tools share the analysis status; do not add
per-tool UI labels. Answer text switches to result preparation; further tool calls
switch back to analysis. Track concurrent tools and clear progress on
completion/error/stop. Keep it independent of debug-log retention and do not expose
arguments, code, ticket content or model reasoning in the status. Update the PR
review help article and tests/review-progress.test.ts in the same change.

When changing tools available to either agent, update docs/help/articles/chat-agent-tools.md
and docs/help/articles/review-agent-tools.md as applicable. Keep shared implementations;
chat and review have independent Agent instances, cancellation and session state.

# Release notes and versioning

Before every push containing changes to application logic or capabilities:

1. Update `services/frontend/src/releases.json` in Russian with concise user-facing release notes.
   Explain changed behaviour, not implementation details. Include features,
   behavioural fixes, tools, defaults, limits, persistence and notification logic.
   Exclude cosmetic-only tweaks, formatting and internal refactors without a
   behaviour change. Do not include secrets or private user/project information.
2. Add one newest-first release for the forthcoming push (combine related work
   into that release). Never rewrite releases that have already been pushed.
   Record the actual release date in YYYY-MM-DD using the user's timezone.
3. Increment MAJOR.MINOR.PATCH: MAJOR for substantial incompatible changes,
   MINOR for compatible new capabilities, PATCH for behavioural fixes. Reset
   lower components on a higher increment. Before 1.0 use the same intent;
   do not bump major for every small new feature. Cosmetic-only changes do not
   require a new release/version.
4. Keep the newest release version, package.json and both root version entries
   in package-lock.json identical. Run `npm run check` before pushing.
5. Continue updating authored help articles in the same change. Release notes
   do not replace help documentation. The sidebar «Что нового» renders the
   bundled release history; it is not an updater or a database migration.

# Work modes

Lead always includes the full product. New features remain available in both Lead
and Developer by default. Exclude a feature from Developer only on the user's
explicit instruction. The currently agreed exclusions are local developers,
local assignments and developer vacations, including their related UI and agent
capabilities. Work mode is not an authorization boundary. Preserve hidden data
and user preferences when switching modes.

# Frontend architecture

Read ARCHITECTURE.md before moving modules or adding frontend areas. Follow FSD
layers and public index.ts entry points for migrated modules. Keep implementation
local to its page/slice until sharing is justified. Do not add new root-level
src TS/TSX files or grow the exact legacy exception list without documenting why.
Keep storage keys, API routes, browser event names and data semantics unchanged
in move-only refactors. Run npm run architecture:check (included in check).
Preserve generated help article IDs through scripts/fsd-moves.json when moving
indexed source files; do not turn module relocation into a user data migration.

# Formatting and repository checks

After every code change, run Prettier on changed supported files (or npm run
format), then regenerate help fingerprints with npm run docs:generate if sources
changed. Run npm run check before finishing: ESLint, Prettier check, FSD, releases,
help and TypeScript. Never run formatting against data/, docker-data/, build
output or generated help. Do not silence new lint errors to make checks pass.
React Hooks and exhaustive-deps are errors; lint accepts zero warnings. Review
effect lifecycles and cancellation rather than mechanically adding dependencies.
Use stable callbacks for subscriptions; keep actual reactive inputs explicit.
Never suppress Hook rules to make checks pass.

Services live in services/frontend/src (FSD), services/backend/src,
services/code-browser and services/voice. Root package/lockfile and Compose remain
shared. Run npm and Compose from the repository root. Keep runtime data locations
and bind mounts stable when reorganizing source files.

# Subagent workflow

For new functionality, changes spanning multiple areas, and fixes with significant
behavioural or data risks, use four subagent roles in the order below. These are
roles in a workflow, not a requirement to run four agents simultaneously. This
section explicitly authorizes delegation for repository work. It does not change
the tool access of Orbit's own chat and review agents.

1. **Requirements.** Start here before implementation. Inspect the request and
   relevant existing behaviour. Produce concise requirements, acceptance criteria,
   edge cases and affected areas. Check compatibility with saved data, Lead and
   Developer modes, related UI, assistant tools and documentation where applicable.
   Identify contradictions, missing decisions and regression risks. Resolve routine
   details within the user's intent; send essential questions to the coordinator
   rather than inventing requirements or expanding scope. User clarification is
   needed only when a material decision cannot safely be inferred, not as a routine
   approval gate for every task.
2. **Development.** Implement against those criteria using existing components and
   architecture. Include necessary migrations or backward-compatible readers, help
   updates and release notes under the rules above. Hand off changed files, a short
   behaviour summary, compatibility assessment, checks already run and remaining
   risks. Do not silently drop acceptance criteria.
3. **UI and UX.** For UI changes, inspect the implemented result in a browser when
   available. Check consistency with existing screens, alignment, spacing, sizes,
   responsive layouts, overflow, menus, dialogs, keyboard/focus behaviour and empty,
   loading, error and success states as applicable. Verify shared forms in each
   entry point. Make bounded presentation fixes only with explicit file ownership;
   return behavioural issues to Development. If browser access is unavailable,
   report that visual verification was not performed; source inspection is not a
   substitute for a rendered check. For backend-only work, state why this stage is
   not applicable.
4. **Testing and regressions.** Independently compare the final implementation with
   the original acceptance criteria. Run repository checks and relevant tests;
   for the full workflow, run the full automated test suite when feasible. Add
   meaningful missing coverage for new logic and significant regression paths.
   Check populated-data upgrades, repeat operations, partial failures and affected
   neighbouring features where relevant. Report exact checks, results and anything
   skipped or unavailable. Send defects back for correction and recheck the affected
   areas after fixes. Never treat passing tests as proof that all bugs are absent.

The primary agent coordinates all stages, retains the user's original request and
clarifications, resolves disagreements, reviews the combined diff and owns the
final commit and push when authorized. Subagents must not commit, push, merge or
change branches independently. Give each stage the relevant requirements, previous
findings and unresolved issues; do not rely on an abbreviated handoff alone to
replace the original request. Do not push with unresolved material defects or
unmet requirements without clearly resolving the scope with the user.

Assign non-overlapping file ownership before parallel edits. Agents share a
workspace: never have multiple agents modify the same files concurrently or undo
another agent's work. Independent verification may run in parallel once its inputs
are ready; coordinate tests that share ports, fixtures or generated files. Respect
current concurrency limits, counting the coordinator as an agent. When slots are
limited, reuse an idle agent for the next role or execute stages sequentially. If
subagent tools are unavailable, perform the applicable stages directly and disclose
that limitation rather than claiming delegation occurred.

## Short workflow for small changes

For narrow, low-risk changes such as spacing, a label, or repository documentation,
use implementation plus the appropriate focused review/checks; the coordinator may
perform these directly without spawning all four roles. A UI tweak still needs a
visual check when feasible, and an instruction/documentation edit needs a review
for clarity and consistency. Escalate to the full workflow if investigation reveals
shared behaviour, data migration, concurrency or wider regression risks. The short
workflow never waives the existing formatting, required checks, data-preservation,
documentation or release rules. Avoid new tests that merely mirror trivial
presentation changes.
