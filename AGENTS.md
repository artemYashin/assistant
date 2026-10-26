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
in server/review-progress.ts. All tools share the analysis status; do not add
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
1. Update `src/releases.json` in Russian with concise user-facing release notes.
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
